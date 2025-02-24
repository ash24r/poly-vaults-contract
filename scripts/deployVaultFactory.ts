import { ethers } from "hardhat";

async function main() {
    console.log("Starting deployment process...");

    // Contract deployment parameters
    const USDC = "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174";
    const CTF = "0x4D97DCd97eC945f40cF65F87097ACe5EA0476045";
    const CTF_EXCHANGE = "0xE46Baa880e3c2EB2261a3e83118EA2E6559BB201";

    console.log("Deployment parameters:");
    console.log(`USDC Address: ${USDC}`);
    console.log(`CTF Address: ${CTF}`);
    console.log(`CTF Exchange Address: ${CTF_EXCHANGE}`);

    console.log("\nDeploying PolyVaultFactory contract...");

    const provider = ethers.getDefaultProvider();
    const gasPrice = (await provider.getFeeData()).gasPrice || BigInt(0);

    console.log(`Current gas price: ${gasPrice}`);

    const PolyVaultFactory = await ethers.getContractFactory("PolyVaultFactory");
    const factory = await PolyVaultFactory.deploy(USDC, CTF, CTF_EXCHANGE, {
        gasPrice: gasPrice,
    });

    console.log("Waiting for deployment confirmation...");
    await factory.waitForDeployment();

    const factoryAddress = await factory.getAddress();
    console.log(`PolyVaultFactory deployed to: ${factoryAddress}`);
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });
