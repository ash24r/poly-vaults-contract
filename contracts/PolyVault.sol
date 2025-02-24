// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./ERC4626Fees.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {ERC1155Holder} from "@openzeppelin/contracts/token/ERC1155/utils/ERC1155Holder.sol";
import {IERC1155} from "@openzeppelin/contracts/token/ERC1155/IERC1155.sol";

interface IERC1271 {
    function isValidSignature(
        bytes32 hash,
        bytes memory signature
    ) external view returns (bytes4);
}

interface ICTF {
    function redeemPositions(
        address collateralToken,
        bytes32 parentCollectionId,
        bytes32 conditionId,
        uint256[] calldata indexSets
    ) external;
}

contract MyPolyVault is ERC4626Fees, ERC1155Holder {
    //For verifying signatures
    using ECDSA for bytes32;
    bytes4 internal constant MAGICVALUE = 0x1626ba7e;

    //USDC, Polymarket Conditional Tokens and CTF Exchange contract addresses
    address public immutable USDC;
    address public immutable CTF;
    address public immutable CTF_EXCHANGE;

    // Address of the manager allowed to execute trades on behalf of the vault
    address public manager;

    // Max Fee Constraints
    uint256 private constant MAX_ENTRY_FEE = 200; //2%
    uint256 private constant MAX_PROFIT_SHARE = 3000; // 30%. Max fees that the manager can receive for creating profitable trades

    //Fee & Profit Tracking
    uint256 public entryFee; //Entry fee for depositors
    uint256 public profitShare; //% of profits to be given to the manager (if vault was profitable during execution)
    uint256 public managerProfit; //USDC profits that the manager earned for trading profitably
    bool public isProfitProcessed; //Whether USDC profits have been distributed to the manager

    //Timeframes for the vault
    uint256 public immutable depositEndTime; //Can only deposit before timer ends
    uint256 public immutable tradingEndTime; //Only manager can trade between deposit end time and trading end time. Deposits & withdrawals not allowed
    uint256 public totalDepositedAmount; //To calculate total USDC deposited at the time of trading commencement. Required for calculating profits

    //ERC-1155 or CTF Tokens Tracking
    uint256[] public ctfTokenIds; //Track incoming ERC-1155 tokens from the CTF contract. Required for multiAssetsRedeem functionality
    mapping(uint256 => bool) private isTokenTracked;

    //Events
    event ProfitsProcessed(
        address manager,
        uint256 totalProfit,
        uint256 managerShare
    );

    enum VaultPhase {
        CAPITAL_FORMATION,
        MARKET_TRADING,
        REDEMPTION
    }

    constructor(
        address manager_,
        uint256 entryFee_,
        string memory name_,
        string memory symbol_,
        address usdc_,
        address ctf_,
        address ctfExchange_,
        uint256 depositEndTime_,
        uint256 tradingEndTime_,
        uint256 profitShare_
    ) ERC4626(IERC20(usdc_)) ERC20(name_, symbol_) {
        require(entryFee_ <= MAX_ENTRY_FEE, "Entry fee exceeds maximum");
        require(manager_ != address(0), "Invalid manager address");
        require(depositEndTime_ > block.timestamp, "Invalid deposit end time");
        require(tradingEndTime_ > depositEndTime_, "Invalid trading end time");
        require(
            profitShare_ <= MAX_PROFIT_SHARE,
            "Profit share exceeds maximum"
        );
        profitShare = profitShare_;

        depositEndTime = depositEndTime_;
        tradingEndTime = tradingEndTime_;

        manager = manager_;
        entryFee = entryFee_;
        USDC = usdc_;
        CTF = ctf_;
        CTF_EXCHANGE = ctfExchange_;
        _setupApprovals();
    }

    //Returns the current phase of the vault
    function getCurrentPhase() public view returns (VaultPhase) {
        if (block.timestamp < depositEndTime) {
            return VaultPhase.CAPITAL_FORMATION;
        } else if (block.timestamp <= tradingEndTime) {
            return VaultPhase.MARKET_TRADING;
        } else {
            return VaultPhase.REDEMPTION;
        }
    }

    // Override fee configuration functions
    function _entryFeeBasisPoints() internal view override returns (uint256) {
        return entryFee;
    }

    function _entryFeeRecipient() internal view override returns (address) {
        return manager;
    }

    //Called by the CTF exchange contract to validate whether the authorized wallet has signed the order before executing
    function isValidSignature(
        bytes32 hash,
        bytes memory signature
    ) external view returns (bytes4) {
        // Only allow signatures to be verified by the CTF_EXCHANGE contract
        require(
            msg.sender == CTF_EXCHANGE,
            "Only exchange contract can verify"
        );

        //Require vault to be in trading phase before any trades can happen
        require(
            getCurrentPhase() == VaultPhase.MARKET_TRADING,
            "Not in trading phase"
        );

        address signer = hash.recover(signature);

        if (signer == manager) {
            return MAGICVALUE;
        }

        return 0xffffffff;
    }

    function _deposit(
        address caller,
        address receiver,
        uint256 assets,
        uint256 shares
    ) internal virtual override {
        //Require vault to be in deposit phase to accept deposits
        require(
            getCurrentPhase() == VaultPhase.CAPITAL_FORMATION,
            "Not in deposit phase"
        );

        //Mint dead shares on first deposit to mitigate inflation attacks
        if (totalSupply() == 0) {
            _mint(address(0x000000000000000000000000000000000000dEaD), 1000);
        }

        super._deposit(caller, receiver, assets, shares);

        //Set total deposited amount to be the current USDC balance of the vault. Required for calculating profits at a later stage
        totalDepositedAmount = IERC20(USDC).balanceOf(address(this));
    }

    //We override redeem function to ensure potential profits are processed before any redemption occurs
    function redeem(
        uint256 shares,
        address receiver,
        address owner
    ) public virtual override returns (uint256) {
        require(
            getCurrentPhase() != VaultPhase.MARKET_TRADING,
            "Cannot redeem during trading phase"
        );
        processProfits();
        return super.redeem(shares, receiver, owner);
    }

    //We override withdraw function to ensure potential profits are processed before any redemption occurs
    function withdraw(
        uint256 assets,
        address receiver,
        address owner
    ) public virtual override returns (uint256) {
        require(
            getCurrentPhase() != VaultPhase.MARKET_TRADING,
            "Cannot withdraw during trading phase"
        );
        processProfits();
        return super.withdraw(assets, receiver, owner);
    }

    //We override _withdraw function to ensure we have the latest totalDepositedAmount to calculate profits
    function _withdraw(
        address caller,
        address receiver,
        address owner,
        uint256 assets,
        uint256 shares
    ) internal virtual override {
        super._withdraw(caller, receiver, owner, assets, shares);

        //If deposit period is still on-going, set the active deposited amount to the USDC balance
        if (getCurrentPhase() == VaultPhase.CAPITAL_FORMATION) {
            totalDepositedAmount = IERC20(USDC).balanceOf(address(this));
        }
    }

    //Only process profits if vault is in redemption phase and the profit has not already been processed
    function processProfits() private {
        if (getCurrentPhase() == VaultPhase.REDEMPTION && !isProfitProcessed) {
            // Process manager's profit first
            uint256 currentBalance = IERC20(USDC).balanceOf(address(this));
            if (currentBalance > totalDepositedAmount) {
                uint256 profit = currentBalance - totalDepositedAmount;
                managerProfit = (profit * profitShare) / 10000;
                IERC20(USDC).transfer(manager, managerProfit);
                emit ProfitsProcessed(manager, profit, managerProfit);
            }
            isProfitProcessed = true;
        }
    }

    //This function is required in the case that manager has active CTF ERC-1155 tokens after the trading period ends.
    // This function helps the users receive a % of the CTF positions so they do not lose out on any potential $ when redeeming shares

    function multiRedeemShares(
        uint256 shares,
        address receiver,
        address owner
    ) public returns (uint256) {
        require(
            getCurrentPhase() == VaultPhase.REDEMPTION,
            "Not in redemption phase"
        );

        require(msg.sender == owner, "Caller must be owner");

        //Calculate % ownership of the users to figure out how many ERC-1155 tokens to transfer (if any)
        uint256 totalSupply = totalSupply();

        //Multiply with 1e6 for better precision
        uint256 ownershipPercentage = (shares * 1e6) / totalSupply;

        //Check if any profits need to be processed before we proceed with USDC redemption for the depositor
        processProfits();
        uint256 assets = super.redeem(shares, receiver, owner);

        //Once all shares have been redeemed, we can now transfer the appropriate % of CTF tokens to the user
        for (uint256 i = 0; i < ctfTokenIds.length; i++) {
            uint256 id = ctfTokenIds[i];
            uint256 balance = IERC1155(CTF).balanceOf(address(this), id);
            if (balance == 0) continue;

            uint256 userTokens = (balance * ownershipPercentage) / 1e6;
            if (userTokens > 0) {
                IERC1155(CTF).safeTransferFrom(
                    address(this),
                    receiver,
                    id,
                    userTokens,
                    ""
                );
            }
        }

        return assets;
    }

    //Allow anyone to redeem position for a resolve prediction.
    function redeemPositions(
        bytes32 parentCollectionId,
        bytes32 conditionId,
        uint256[] calldata indexSets
    ) external {
        ICTF(CTF).redeemPositions(
            USDC,
            parentCollectionId,
            conditionId,
            indexSets
        );
    }

    //Keep a track of any incoming CTF 1155 tokens. Required for multi-assets-redemption function
    function onERC1155Received(
        address operator,
        address from,
        uint256 id,
        uint256 value,
        bytes memory data
    ) public virtual override returns (bytes4) {
        if (msg.sender == CTF && !isTokenTracked[id]) {
            ctfTokenIds.push(id);
            isTokenTracked[id] = true;
        }
        return this.onERC1155Received.selector;
    }

    //Setup approvals for the exchange and conditional token contracts to transfer assets from within this vault
    function _setupApprovals() internal {
        // USDC approvals
        IERC20(USDC).approve(CTF_EXCHANGE, type(uint256).max);
        IERC20(USDC).approve(CTF, type(uint256).max);

        // CTF approval
        IERC1155(CTF).setApprovalForAll(CTF_EXCHANGE, true);
    }
}
