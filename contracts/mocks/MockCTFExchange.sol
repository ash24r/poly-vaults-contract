// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC1155/IERC1155.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "../PolyVault.sol";
import "@openzeppelin/contracts/token/ERC1155/utils/ERC1155Holder.sol";

contract MockCTFExchange is ERC1155Holder {
    using ECDSA for bytes32;
    
    address public immutable ctf;
    address public immutable usdc;
    bytes4 private constant MAGICVALUE = 0x1626ba7e;

    struct Order {
        address trader;
        uint256 tokenId;
        uint256 amount;
        uint256 price;
        bool isSell;
    }

    constructor(address _ctf, address _usdc) {
        ctf = _ctf;
        usdc = _usdc;
    }

    function matchOrders(
        Order calldata buyOrder,
        Order calldata sellOrder,
        bytes32 buyHash,
        bytes32 sellHash,
        bytes memory buySignature,
        bytes memory sellSignature
    ) external {
        // Verify orders match
        require(buyOrder.tokenId == sellOrder.tokenId, "Token ID mismatch");
        require(buyOrder.amount == sellOrder.amount, "Amount mismatch");
        require(buyOrder.price == sellOrder.price, "Price mismatch");
        require(buyOrder.isSell != sellOrder.isSell, "Order type mismatch");

        // Verify buy signature
        if (isContract(buyOrder.trader)) {
            require(
                IERC1271(buyOrder.trader).isValidSignature(buyHash, buySignature) == MAGICVALUE,
                "Invalid buy signature"
            );
        } else {
            require(
                buyHash.recover(buySignature) == buyOrder.trader,
                "Invalid buy signature"
            );
        }

        // Verify sell signature
        if (isContract(sellOrder.trader)) {
            require(
                IERC1271(sellOrder.trader).isValidSignature(sellHash, sellSignature) == MAGICVALUE,
                "Invalid sell signature"
            );
        } else {
            require(
                sellHash.recover(sellSignature) == sellOrder.trader,
                "Invalid sell signature"
            );
        }

        // Execute transfers
        IERC20(usdc).transferFrom(buyOrder.trader, sellOrder.trader, buyOrder.price);
        IERC1155(ctf).safeTransferFrom(
            sellOrder.trader,
            buyOrder.trader,
            buyOrder.tokenId,
            buyOrder.amount,
            ""
        );
    }

    function isContract(address addr) internal view returns (bool) {
        uint256 size;
        assembly {
            size := extcodesize(addr)
        }
        return size > 0;
    }
}
