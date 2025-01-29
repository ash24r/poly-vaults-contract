import { ethers } from "hardhat";

async function main() {
  console.log("Starting deployment process...");

  // Contract deployment parameters
  const USDC = "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174";
  const CTF = "0x4D97DCd97eC945f40cF65F87097ACe5EA0476045";
  const CTF_EXCHANGE = "0xDbb03cb4a7AF258012Ebf319fedc0c4484861c95";
  const manager = "0x113128f65D830b5295cef847597F4655f3d8E47C"; // Replace with actual manager address
  const entryFee = 0; // 1%
  const exitFee = 0; // 1%
  const name = "Ash Pro Bettor Vault";
  const symbol = "PBT";

  console.log("Deployment parameters:");
  console.log(`USDC Address: ${USDC}`);
  console.log(`CTF Address: ${CTF}`);
  console.log(`CTF Exchange Address: ${CTF_EXCHANGE}`);
  console.log(`Manager Address: ${manager}`);
  console.log(`Entry Fee: ${entryFee}`);
  console.log(`Exit Fee: ${exitFee}`);
  console.log(`Name: ${name}`);
  console.log(`Symbol: ${symbol}`);

  console.log("\nDeploying MyPolyVault contract...");

  const provider = ethers.getDefaultProvider();
  const gasPrice = (await provider.getFeeData()).gasPrice || BigInt(0);
  const increasedGasPrice = 109980134630;

  console.log(`Current gas price: ${gasPrice}`);
  console.log(`Increased gas price: ${increasedGasPrice}`);

  // Deploy the vault with updated constructor parameters
  const PolyVault = await ethers.getContractFactory("MyPolyVault");
  const vault = await PolyVault.deploy(
    USDC,
    manager,
    entryFee,
    exitFee,
    name,
    symbol,
    USDC,
    CTF,
    CTF_EXCHANGE,
    {
      gasPrice: increasedGasPrice,
    }
  );

  console.log("Waiting for deployment confirmation...");
  await vault.waitForDeployment();

  const vaultAddress = await vault.getAddress();
  console.log(`PolyVault deployed to: ${vaultAddress}`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
