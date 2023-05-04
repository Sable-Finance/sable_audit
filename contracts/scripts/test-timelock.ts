import { Wallet, BigNumber } from "ethers";

const { ethers, upgrades } = require("hardhat");
const { BN, time } = require("@openzeppelin/test-helpers");
const { defaultAbiCoder, Interface } = require("@ethersproject/abi");

const abi = require("./../artifacts/contracts/TimeLock.sol/TimeLock.json");

async function main() {
  const provider = new ethers.providers.JsonRpcProvider("http://localhost:8545", 17);
  const signer = new ethers.Wallet(
    "0x4d5db4107d237df6a3d58ee5f70ae63d73d7658d4026f2eefd2f204c81682cb7",
    provider
  );

  const contractAddress = "0x53F6337d308FfB2c52eDa319Be216cC7321D3725";
  const systemState = "0x2A2B68E9Bf718DBf6dF3dF91174A136054a8A0Ec";

  const timeLock = new ethers.Contract(contractAddress, abi.abi, signer);
  // let now = Math.floor(new Date().getTime() / 1000); ;
  // let executeTime = new BN(now).add(new BN("10")).add(new BN("200")); // 200 second after min delay
  // console.log("🚀 ~ file: test-timelock.ts:22 ~ main ~ executeTime:", executeTime)
  const iface = new Interface(["function setLUSDGasCompensation(uint)"]);
  const newValue = iface.encodeFunctionData("setLUSDGasCompensation", [1000]);
  let tx = await timeLock.connect(signer).queue(systemState, 0, "", newValue, "1680770589");
  // const id = await timeLock.getTxId(systemState, 0, "", newValue,  executeTime.toString());
  //   let tx = await timeLock.connect(signer).cancel("0x475cf19164e173188aa22d4f7c0ce9daf2709237a0c72ae303fb8e4ea104eff7");
  await tx.wait();
  console.log("Approval success");
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});

/*
WEBUY_ENV=SOTATEK npx hardhat run governance/createProposal.ts --network klaytnBaobab
*/
