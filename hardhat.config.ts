import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import * as dotenv from "dotenv";

dotenv.config();

const config: HardhatUserConfig = {
  solidity: "0.8.28",
  networks: {
    polygon: {
      url: process.env.POLYGON_RPC,
      accounts: [process.env.PRIVATE_KEY || ""],
      gasPrice: "auto",
      gas: "auto"
    }
  },
  etherscan: {
    apiKey: {
      polygon: process.env.POLYGON_SCAN_KEY || ""
    }
  }
};

export default config;
