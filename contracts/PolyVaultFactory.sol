// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./PolyVault.sol";

contract PolyVaultFactory {
    // Event emitted when new vault is created
    event VaultCreated(
        address indexed vault,
        address indexed manager,
        string name,
        string symbol,
        uint256 entryFee,
        uint256 depositEndTime,
        uint256 tradingEndTime,
        uint256 profitShare
    );

    // Store deployed vaults
    address[] public deployedVaults;

    // Fixed addresses that will be the same for all vaults
    address public immutable USDC;
    address public immutable CTF;
    address public immutable CTF_EXCHANGE;

    constructor(address usdc_, address ctf_, address ctfExchange_) {
        USDC = usdc_;
        CTF = ctf_;
        CTF_EXCHANGE = ctfExchange_;
    }

    function createVault(
        address manager_,
        uint256 entryFee_,
        string memory name_,
        string memory symbol_,
        uint256 depositEndTime_,
        uint256 tradingEndTime_,
        uint256 profitShare_
    ) external returns (address) {
        MyPolyVault vault = new MyPolyVault(
            manager_,
            entryFee_,
            name_,
            symbol_,
            USDC,
            CTF,
            CTF_EXCHANGE,
            depositEndTime_,
            tradingEndTime_,
            profitShare_
        );

        deployedVaults.push(address(vault));

        emit VaultCreated(
            address(vault),
            manager_,
            name_,
            symbol_,
            entryFee_,
            depositEndTime_,
            tradingEndTime_,
            profitShare_
        );

        return address(vault);
    }

    function getDeployedVaults() external view returns (address[] memory) {
        return deployedVaults;
    }
}
