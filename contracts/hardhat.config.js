require("@nomiclabs/hardhat-truffle5");
require("@nomiclabs/hardhat-ethers");
require("@nomiclabs/hardhat-etherscan");
require("solidity-coverage");
require("hardhat-gas-reporter");

const accounts = require("./hardhatAccountsList2k.js");
const accountsList = accounts.accountsList;

const fs = require("fs");
const getSecret = (secretKey, defaultValue = "") => {
  const SECRETS_FILE = "./secrets.js";
  let secret = defaultValue;
  if (fs.existsSync(SECRETS_FILE)) {
    const { secrets } = require(SECRETS_FILE);
    if (secrets[secretKey]) {
      secret = secrets[secretKey];
    }
  }

  return secret;
};
const alchemyUrl = () => {
  return `https://eth-mainnet.alchemyapi.io/v2/${getSecret("alchemyAPIKey")}`;
};

const alchemyUrlRinkeby = () => {
  return `https://eth-rinkeby.alchemyapi.io/v2/${getSecret("alchemyAPIKeyRinkeby")}`;
};

const bscTestnetUrl = () => {
  return `https://data-seed-prebsc-2-s1.binance.org:8545`
}

const bscUrl = () => {
  return `https://bsc-dataseed1.binance.org/`
}

module.exports = {
  paths: {
    // contracts: "./contracts",
    // artifacts: "./artifacts"
  },
  solidity: {
    compilers: [
      {
        version: "0.4.23",
        settings: {
          optimizer: {
            enabled: true,
            runs: 100
          }
        }
      },
      {
        version: "0.5.17",
        settings: {
          optimizer: {
            enabled: true,
            runs: 100
          }
        }
      },
      {
        version: "0.6.11",
        settings: {
          optimizer: {
            enabled: true,
            runs: 1
          }
        }
      }
    ],
    optimizer: {
      enabled: true
    }
  },
  allowUnlimitedContractSize: true,
  networks: {
    hardhat: {
      accounts: accountsList,
      gas: 10000000, // tx gas limit
      blockGasLimit: 15000000,
      gasPrice: 20000000000,
      initialBaseFeePerGas: 0,
      allowUnlimitedContractSize: true
    },
    mainnet: {
      url: alchemyUrl(),
      gasPrice: process.env.GAS_PRICE ? parseInt(process.env.GAS_PRICE) : 20000000000,
      accounts: [
        getSecret(
          "DEPLOYER_PRIVATEKEY",
          "0x60ddfe7f579ab6867cbe7a2dc03853dc141d7a4ab6dbefc0dae2d2b1bd4e487f"
        ),
        getSecret(
          "ACCOUNT2_PRIVATEKEY",
          "0x3ec7cedbafd0cb9ec05bf9f7ccfa1e8b42b3e3a02c75addfccbfeb328d1b383b"
        )
      ]
    },
    rinkeby: {
      url: alchemyUrlRinkeby(),
      gas: 10000000, // tx gas limit
      accounts: [
        getSecret(
          "RINKEBY_DEPLOYER_PRIVATEKEY",
          "0x60ddfe7f579ab6867cbe7a2dc03853dc141d7a4ab6dbefc0dae2d2b1bd4e487f"
        )
      ]
    },
    bscTestnet: {
      url: bscTestnetUrl(),
      gas: 10000000,
      accounts: [getSecret('BSC_DEPLOYER_PRIVATEKEY', '0x60ddfe7f579ab6867cbe7a2dc03853dc141d7a4ab6dbefc0dae2d2b1bd4e487f')]
    },
    bsc: {
        url: bscUrl(),
        gas: 10000000,
        accounts: [getSecret('BSC_DEPLOYER_PRIVATEKEY', '0x60ddfe7f579ab6867cbe7a2dc03853dc141d7a4ab6dbefc0dae2d2b1bd4e487f')]
    },
  },
  etherscan: {
    apiKey: getSecret("BSCSCAN_API_KEY")
  },
  mocha: { timeout: 12000000 },
  rpc: {
    host: "localhost",
    port: 8545
  },
  gasReporter: {
    enabled: process.env.REPORT_GAS ? true : false
  }
};
