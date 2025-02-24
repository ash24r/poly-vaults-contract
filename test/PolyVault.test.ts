import { expect } from "chai";
import { ethers } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import {
  PolyVaultFactory,
  MyPolyVault,
  MockERC20,
  MockCTF,
  MockCTFExchange
} from "../typechain-types";

describe("PolyVault Basic Setup", function () {
  let vaultFactory: PolyVaultFactory;
  let vault: MyPolyVault;
  let usdc: MockERC20;
  let ctf: MockCTF;
  let ctfExchange: MockCTFExchange;
  let owner: SignerWithAddress;
  let manager: SignerWithAddress;
  let user1: SignerWithAddress;
  let user2: SignerWithAddress;

  const ENTRY_FEE = 0;
  const PROFIT_SHARE = 2000; // 20%
  let depositEndTime: number;
  let tradingEndTime: number;

  beforeEach(async function () {
    [owner, manager, user1, user2] = await ethers.getSigners();

    // Deploy mock USDC
    const MockToken = await ethers.getContractFactory("MockERC20");
    usdc = await MockToken.deploy("USDC", "USDC");

    // Deploy mock CTF
    const MockCTFContract = await ethers.getContractFactory("MockCTF");
    ctf = await MockCTFContract.deploy();

    // Deploy mock CTF Exchange
    const MockExchange = await ethers.getContractFactory("MockCTFExchange");
    ctfExchange = await MockExchange.deploy(
      await ctf.getAddress(),
      await usdc.getAddress()
    );

    const currentTime = await time.latest();
    depositEndTime = currentTime + 86400; // 24 hours
    tradingEndTime = depositEndTime + 86400; // 48 hours total

    // Deploy factory
    const Factory = await ethers.getContractFactory("PolyVaultFactory");
    vaultFactory = await Factory.deploy(
      await usdc.getAddress(),
      await ctf.getAddress(),
      await ctfExchange.getAddress()
    );

    // Create vault through factory
    await vaultFactory.createVault(
      manager.address,
      ENTRY_FEE,
      "Test Vault",
      "TVLT",
      depositEndTime,
      tradingEndTime,
      PROFIT_SHARE
    );

    const vaultAddress = (await vaultFactory.getDeployedVaults())[0];
    vault = await ethers.getContractAt("MyPolyVault", vaultAddress);
  });

  describe("Initialization", function () {
    it("Should set correct initial parameters", async function () {
      expect(await vault.manager()).to.equal(manager.address);
      // Convert to BigInt for comparison
      expect(await vault.entryFee()).to.equal(BigInt(ENTRY_FEE));
      expect(await vault.profitShare()).to.equal(BigInt(PROFIT_SHARE));
      expect(await vault.depositEndTime()).to.equal(BigInt(depositEndTime));
      expect(await vault.tradingEndTime()).to.equal(BigInt(tradingEndTime));
    });


    it("Should have correct USDC approvals", async function () {
      const vaultAddress = await vault.getAddress();
      expect(await usdc.allowance(vaultAddress, await ctf.getAddress())).to.equal(ethers.MaxUint256);
      expect(await usdc.allowance(vaultAddress, await ctfExchange.getAddress())).to.equal(ethers.MaxUint256);
    });
  });

  describe("Deposit Period", function () {
    beforeEach(async function () {
      await usdc.mint(user1.address, ethers.parseUnits("100", 6));
      await usdc.connect(user1).approve(vault.getAddress(), ethers.MaxUint256);
    });

    it("Should accept deposits during deposit period", async function () {
      const depositAmount = ethers.parseUnits("100", 6);
      await vault.connect(user1).deposit(depositAmount, user1.address);

      // expect(await vault.balanceOf(user1.address)).to.be.gt(0);
      expect(await Number(await vault.totalDepositedAmount())).to.be.gt(0);
    });

    it("Should apply correct entry fee", async function () {
      const depositAmount = ethers.parseUnits("100", 6);
      await vault.connect(user1).deposit(depositAmount, user1.address);

      const numerator = depositAmount * BigInt(ENTRY_FEE);
      const denominator = BigInt(ENTRY_FEE) + 10000n;
      const expectedFee = (numerator + denominator - 1n) / denominator;
      expect(await usdc.balanceOf(manager.address)).to.equal(expectedFee);
    });

    it("Should reject deposits after deposit period", async function () {
      await time.increase(86401); // Move past deposit end time

      const depositAmount = ethers.parseUnits("100", 6);
      await expect(
        vault.connect(user1).deposit(depositAmount, user1.address)
      ).to.be.reverted;
    });
  });

  describe("Trading Period", function () {
    const tokenId = 1;
    const amount = 100;
    const price = ethers.parseUnits("50", 6);

    beforeEach(async function () {
      // Setup initial deposits
      await usdc.mint(user1.address, ethers.parseUnits("100", 6));
      await usdc.connect(user1).approve(vault.getAddress(), ethers.MaxUint256);
      await vault.connect(user1).deposit(ethers.parseUnits("100", 6), user1.address);

      // Move to trading period
      await time.increase(86400);

      // Setup CTF Exchange
      await ctf.mint(ctfExchange.getAddress(), tokenId, amount);
      await usdc.mint(user2.address, price);
      await usdc.connect(user2).approve(ctfExchange.getAddress(), price);
    });


    it("Should execute trade with valid manager signature and accumulate profit", async function () {
      const tokenId = 1;
      const amount = 100;
      const price = ethers.parseUnits("50", 6);
      const sellPrice = ethers.parseUnits("100", 6);

      // Initial setup - mint CTF to user2 and approve exchange
      await ctf.mint(user2.address, tokenId, amount);
      await ctf.connect(user2).setApprovalForAll(ctfExchange.getAddress(), true);

      // First trade - Vault buys from user2
      const firstBuyOrder = {
        trader: await vault.getAddress(),
        tokenId: tokenId,
        amount: amount,
        price: price,
        isSell: false
      };

      const firstSellOrder = {
        trader: user2.address,
        tokenId: tokenId,
        amount: amount,
        price: price,
        isSell: true
      };

      // Create and sign orders
      const buyHash = ethers.keccak256(
        ethers.AbiCoder.defaultAbiCoder().encode(
          ["address", "uint256", "uint256", "uint256", "bool"],
          [firstBuyOrder.trader, firstBuyOrder.tokenId, firstBuyOrder.amount, firstBuyOrder.price, firstBuyOrder.isSell]
        )
      );

      const sellHash = ethers.keccak256(
        ethers.AbiCoder.defaultAbiCoder().encode(
          ["address", "uint256", "uint256", "uint256", "bool"],
          [firstSellOrder.trader, firstSellOrder.tokenId, firstSellOrder.amount, firstSellOrder.price, firstSellOrder.isSell]
        )
      );

      const buyHashMessage = ethers.hashMessage(ethers.getBytes(buyHash));
      const sellHashMessage = ethers.hashMessage(ethers.getBytes(sellHash));

      const buySignature = await manager.signMessage(ethers.getBytes(buyHash));
      const sellSignature = await user2.signMessage(ethers.getBytes(sellHash));

      // Setup approvals and balances
      await usdc.connect(user2).approve(ctfExchange.getAddress(), price);

      // Execute first trade
      await ctfExchange.matchOrders(
        firstBuyOrder,
        firstSellOrder,
        buyHashMessage,
        sellHashMessage,
        buySignature,
        sellSignature
      );

      // Second trade - Vault sells to user2 at higher price
      const secondSellOrder = {
        trader: await vault.getAddress(),
        tokenId: tokenId,
        amount: amount,
        price: sellPrice,
        isSell: true
      };

      const secondBuyOrder = {
        trader: user2.address,
        tokenId: tokenId,
        amount: amount,
        price: sellPrice,
        isSell: false
      };

      const secondBuyHash = ethers.keccak256(
        ethers.AbiCoder.defaultAbiCoder().encode(
          ["address", "uint256", "uint256", "uint256", "bool"],
          [secondBuyOrder.trader, secondBuyOrder.tokenId, secondBuyOrder.amount, secondBuyOrder.price, secondBuyOrder.isSell]
        )
      );

      const secondSellHash = ethers.keccak256(
        ethers.AbiCoder.defaultAbiCoder().encode(
          ["address", "uint256", "uint256", "uint256", "bool"],
          [secondSellOrder.trader, secondSellOrder.tokenId, secondSellOrder.amount, secondSellOrder.price, secondSellOrder.isSell]
        )
      );

      const secondBuyHashMessage = ethers.hashMessage(ethers.getBytes(secondBuyHash));
      const secondSellHashMessage = ethers.hashMessage(ethers.getBytes(secondSellHash));


      const secondBuySignature = await user2.signMessage(ethers.getBytes(secondBuyHash));
      const secondSellSignature = await manager.signMessage(ethers.getBytes(secondSellHash));

      // Setup for second trade
      await usdc.connect(user2).approve(ctfExchange.getAddress(), sellPrice);

      // Execute second trade
      await ctfExchange.matchOrders(
        secondBuyOrder,
        secondSellOrder,
        secondBuyHashMessage,
        secondSellHashMessage,
        secondBuySignature,
        secondSellSignature
      );

      const vaultBalanceAfterTrade = await usdc.balanceOf(await vault.getAddress());
      const initialManagerBalance = await usdc.balanceOf(manager.address);

      // Move to withdrawal period
      await time.increase(86400); // Move past trading end time

      // Calculate expected profit distribution
      const totalProfit = vaultBalanceAfterTrade - await vault.totalDepositedAmount();
      const expectedManagerProfit = (totalProfit * BigInt(PROFIT_SHARE)) / 10000n;
      const expectedDepositorShare = totalProfit - expectedManagerProfit;

      // Process withdrawal
      const totalShares = await vault.totalSupply(); // This includes the 1000 dead shares
      const userShares = await vault.balanceOf(user1.address);

      const shares = await vault.balanceOf(user1.address);
      await vault.connect(user1).redeem(shares, user1.address, user1.address);

      // // Verify profit distribution
      expect(await usdc.balanceOf(manager.address)).to.equal(
        initialManagerBalance + expectedManagerProfit
      );
      expect(await vault.managerProfit()).to.equal(expectedManagerProfit);


      const userShareRatio = userShares * BigInt(1e6) / totalShares;
      const expectedUserBalance = (await vault.totalDepositedAmount() + expectedDepositorShare) * userShareRatio / BigInt(1e6);


      expect(await usdc.balanceOf(user1.address)).to.be.closeTo(expectedUserBalance, 1);
    });

    it("Should reject trade with incorrect manager signature", async function () {
      const tokenId = 1;
      const amount = 100;
      const price = ethers.parseUnits("50", 6);

      // Create orders
      const buyOrder = {
        trader: await vault.getAddress(),
        tokenId: tokenId,
        amount: amount,
        price: price,
        isSell: false
      };

      const sellOrder = {
        trader: user2.address,
        tokenId: tokenId,
        amount: amount,
        price: price,
        isSell: true
      };

      // Create hashes
      const buyHash = ethers.keccak256(
        ethers.AbiCoder.defaultAbiCoder().encode(
          ["address", "uint256", "uint256", "uint256", "bool"],
          [buyOrder.trader, buyOrder.tokenId, buyOrder.amount, buyOrder.price, buyOrder.isSell]
        )
      );

      const sellHash = ethers.keccak256(
        ethers.AbiCoder.defaultAbiCoder().encode(
          ["address", "uint256", "uint256", "uint256", "bool"],
          [sellOrder.trader, sellOrder.tokenId, sellOrder.amount, sellOrder.price, sellOrder.isSell]
        )
      );

      // Sign with wrong signer (user1 instead of manager)
      const buySignature = await user1.signMessage(ethers.getBytes(buyHash));
      const sellSignature = await user2.signMessage(ethers.getBytes(sellHash));

      const buyHashMessage = ethers.hashMessage(ethers.getBytes(buyHash));
      const sellHashMessage = ethers.hashMessage(ethers.getBytes(sellHash));

      // Should fail when matching orders
      await expect(
        ctfExchange.matchOrders(
          buyOrder,
          sellOrder,
          buyHashMessage,
          sellHashMessage,
          buySignature,
          sellSignature
        )
      ).to.be.reverted;
    });


  });

  describe("Withdrawal Period", function () {
    beforeEach(async function () {

      await usdc.mint(user1.address, ethers.parseUnits("100", 6));
      await usdc.connect(user1).approve(vault.getAddress(), ethers.MaxUint256);
      await vault.connect(user1).deposit(ethers.parseUnits("100", 6), user2.address);

      await usdc.mint(user2.address, ethers.parseUnits("100", 6));
      await usdc.connect(user2).approve(vault.getAddress(), ethers.MaxUint256);
      await vault.connect(user2).deposit(ethers.parseUnits("100", 6), user2.address);
    });

    it("Should reject withdrawals during trading period", async function () {
      await time.increase(86400);
      const shares = await vault.balanceOf(user1.address);

      await expect(
        vault.connect(user1).redeem(shares, user1.address, user1.address)
      ).to.be.revertedWith("Cannot redeem during trading phase");
    });

    it("Should process correct profit amount when multiple users withdraw", async function () {
      await time.increase(86400);

      const profitAmount = ethers.parseUnits("50", 6); // 50 USDC profit
      await usdc.mint(await vault.getAddress(), profitAmount);

      await time.increase(172800); // Move to withdrawal period

      const initialVaultBalance = await usdc.balanceOf(await vault.getAddress());
      const initialManagerBalance = await usdc.balanceOf(manager.address);

      // Process both withdrawals
      const user1Shares = await vault.balanceOf(user1.address);
      const user2Shares = await vault.balanceOf(user2.address);

      await vault.connect(user1).redeem(user1Shares, user1.address, user1.address);
      await vault.connect(user2).redeem(user2Shares, user2.address, user2.address);

      // Calculate expected profit
      const totalProfit = initialVaultBalance - await vault.totalDepositedAmount();
      const expectedManagerProfit = (totalProfit * BigInt(PROFIT_SHARE)) / 10000n;

      // Verify manager received exactly the right amount
      expect(await usdc.balanceOf(manager.address)).to.equal(initialManagerBalance + expectedManagerProfit);
      expect(await vault.managerProfit()).to.equal(expectedManagerProfit);
      expect(await vault.isProfitProcessed()).to.equal(true);
    });

    it("Should process withdrawal and profit share correctly", async function () {
      await time.increase(172800); // Move to withdrawal period

      const initialVaultBalance = await usdc.balanceOf(await vault.getAddress());
      const initialManagerBalance = await usdc.balanceOf(manager.address);
      const shares = await vault.balanceOf(user1.address);

      await vault.connect(user1).redeem(shares, user1.address, user1.address);

      const profit = initialVaultBalance - await vault.totalDepositedAmount();
      const expectedManagerProfit = (profit * BigInt(PROFIT_SHARE)) / 10000n;

      expect(await usdc.balanceOf(manager.address)).to.equal(initialManagerBalance + expectedManagerProfit);
      expect(await vault.managerProfit()).to.equal(expectedManagerProfit);
      expect(await vault.isProfitProcessed()).to.equal(true);
      expect(await vault.balanceOf(user1.address)).to.equal(0);
    });
  });

  describe("MultiWithdraw Functionality", function () {

    beforeEach(async function () {
      // Setup initial deposits from both users
      await usdc.mint(user1.address, ethers.parseUnits("100", 6));
      await usdc.mint(user2.address, ethers.parseUnits("100", 6));
      await usdc.connect(user1).approve(vault.getAddress(), ethers.MaxUint256);
      await usdc.connect(user2).approve(vault.getAddress(), ethers.MaxUint256);

      // User1 deposits 60 USDC (60% ownership)
      await vault.connect(user1).deposit(ethers.parseUnits("60", 6), user1.address);
      // User2 deposits 40 USDC (40% ownership)
      await vault.connect(user2).deposit(ethers.parseUnits("40", 6), user2.address);

      // Move to trading period
      await time.increase(86400);

      // Mint some CTF tokens to the vault during trading
      await ctf.mint(await vault.getAddress(), 1, ethers.parseUnits("10", 6)); // TokenId 1
      await ctf.mint(await vault.getAddress(), 2, ethers.parseUnits("20", 6)); // TokenId 2

      // Add some profits
      await usdc.mint(await vault.getAddress(), ethers.parseUnits("10000", 6));

      // Move to redemption period
      await time.increase(86400);
    });

    it("Should correctly distribute ERC1155 tokens based on ownership percentage", async function () {
      const user1Shares = Number(await vault.balanceOf(user1.address));
      const user2Shares = Number(await vault.balanceOf(user2.address));
      const totalShares = Number(await vault.totalSupply());

      // Get initial balances for each token
      const vaultToken1Balance = await ctf.balanceOf(await vault.getAddress(), 1);
      const vaultToken2Balance = await ctf.balanceOf(await vault.getAddress(), 2);

      // Calculate exact ownership percentages 
      const user1ShareRatio = Number((user1Shares) / totalShares);
      const user2ShareRatio = Number((user2Shares) / totalShares);

      // User1 multiwithdraw
      await vault.connect(user1).multiRedeemShares(
        user1Shares,
        user1.address,
        user1.address
      );

      const expectedUser1Token1 = (Number(vaultToken1Balance) * user1ShareRatio).toFixed(0);
      const expectedUser1Token2 = (Number(vaultToken2Balance) * user1ShareRatio).toFixed(0);

      expect(await ctf.balanceOf(user1.address, 1)).to.equal(BigInt(expectedUser1Token1));
      expect(await ctf.balanceOf(user1.address, 2)).to.equal(expectedUser1Token2);

      // User2 multiwithdraw
      await vault.connect(user2).multiRedeemShares(
        user2Shares,
        user2.address,
        user2.address
      );

      const expectedUser2Token1 = (Number(vaultToken1Balance) * user2ShareRatio).toFixed(0);
      const expectedUser2Token2 = (Number(vaultToken2Balance) * user2ShareRatio).toFixed(0);

      expect(await ctf.balanceOf(user2.address, 1)).to.be.closeTo(expectedUser2Token1, 1);
      expect(await ctf.balanceOf(user2.address, 2)).to.closeTo(expectedUser2Token2, 1);
    });

  });

});
