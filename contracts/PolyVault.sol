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
        uint256[] calldata indexSets // Explicitly using uint256
    ) external;
}

contract MyPolyVault is ERC4626Fees, ERC1155Holder {
    uint256 private constant MAX_FEE = 200; // 2% = 200 basis points

    //For verifying signatures
    using ECDSA for bytes32;
    bytes4 internal constant MAGICVALUE = 0x1626ba7e;

    //Polymarket contract addresses
    address public immutable USDC;
    address public immutable CTF;
    address public immutable CTF_EXCHANGE;

    // Manager that can do trades and receive fees
    address public manager;

    // Fee settings (100 = 1%)
    uint256 public entryFee;
    uint256 public exitFee;

    constructor(
        address manager_,
        uint256 entryFee_,
        uint256 exitFee_,
        string memory name_,
        string memory symbol_,
        address usdc_,
        address ctf_,
        address ctfExchange_
    ) ERC4626(IERC20(usdc_)) ERC20(name_, symbol_) {
        require(entryFee_ <= MAX_FEE, "Entry fee exceeds maximum");
        require(exitFee_ <= MAX_FEE, "Exit fee exceeds maximum");
        require(manager_ != address(0), "Invalid manager address");

        manager = manager_;
        entryFee = entryFee_;
        exitFee = exitFee_;
        USDC = usdc_;
        CTF = ctf_;
        CTF_EXCHANGE = ctfExchange_;
        _setupApprovals();
    }

    // Override fee configuration functions
    function _entryFeeBasisPoints() internal view override returns (uint256) {
        return entryFee;
    }

    function _exitFeeBasisPoints() internal view override returns (uint256) {
        return exitFee;
    }

    function _entryFeeRecipient() internal view override returns (address) {
        return manager;
    }

    function _exitFeeRecipient() internal view override returns (address) {
        return manager;
    }

    function isValidSignature(
        bytes32 hash,
        bytes memory signature
    ) external view returns (bytes4) {
        address signer = hash.recover(signature);

        if (signer == manager) {
            return MAGICVALUE;
        }

        return 0xffffffff;
    }

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

    function _setupApprovals() internal {
        // USDC approvals
        IERC20(USDC).approve(CTF_EXCHANGE, type(uint256).max);
        IERC20(USDC).approve(CTF, type(uint256).max);

        // CTF approval
        IERC1155(CTF).setApprovalForAll(CTF_EXCHANGE, true);
    }
}
