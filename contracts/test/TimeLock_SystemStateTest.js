const testHelpers = require("../utils/testHelpers.js");
const deploymentHelper = require("../utils/deploymentHelpers.js");
const { defaultAbiCoder, Interface } = require("@ethersproject/abi");

const { assertRevert } = testHelpers.TestHelper;

const { expect } = require("chai");

const th = testHelpers.TestHelper;
const dec = th.dec;
const toBN = th.toBN;
const { BN, time } = require("@openzeppelin/test-helpers");

require("chai").use(function (chai, utils) {
  chai.Assertion.overwriteMethod("almostEqualDiv1e18", function (original) {
    return function (value) {
      if (utils.flag(this, "bignumber")) {
        const expected = new BN(value);
        const actual = new BN(this._obj);
        almostEqualDiv1e18.apply(this, [expected, actual]);
      } else {
        original.apply(this, arguments);
      }
    };
  });
});

contract("TimeLock-SystemState", async accounts => {
  const ZERO_ADDRESS = th.ZERO_ADDRESS;
  const [owner, alice, bob, carol] = accounts;

  const [bountyAddress, lpRewardsAddress, multisig] = accounts.slice(997, 1000);

  let systemState;
  let timeLock;
  let stabilityPool;

  let minDelay;

  let contracts;
  beforeEach(async () => {
    contracts = await deploymentHelper.deployLiquityCore();
    const MINT_AMOUNT = toBN(dec(100000000, 18));
    const LQTYContracts = await deploymentHelper.deployLQTYContracts(
      bountyAddress,
      MINT_AMOUNT
    );
    systemState = contracts.systemState;
    timeLock = contracts.timeLock;
    stabilityPool = contracts.stabilityPool;

    ;
    await deploymentHelper.connectCoreContracts(contracts, LQTYContracts);
    await deploymentHelper.connectLQTYContractsToCore(LQTYContracts, contracts);
    minDelay = await timeLock.getMinDelay();
  });

  it("SystemState - will return with set default", async () => {
    expect(await systemState.getMCR()).to.be.bignumber.equal("1100000000000000000");
    expect(await systemState.getCCR()).to.be.bignumber.equal("1500000000000000000");
    expect(await systemState.getLUSDGasCompensation()).to.be.bignumber.equal((200e18).toString());
    expect(await systemState.getMinNetDebt()).to.be.bignumber.equal("1800000000000000000000");
    expect(await systemState.getBorrowingFeeFloor()).to.be.bignumber.equal((5e15).toString());
    expect(await systemState.getRedemptionFeeFloor()).to.be.bignumber.equal((5e15).toString());
  });

  it("System state will revert with call from different timelock", async () => {
    await assertRevert(systemState.setMCR(1000), "Caller is not from timelock");
    await assertRevert(systemState.setCCR(1000), "Caller is not from timelock");
    await assertRevert(systemState.setLUSDGasCompensation(1000), "Caller is not from timelock");
    await assertRevert(systemState.setMinNetDebt(1000), "Caller is not from timelock");
    await assertRevert(systemState.setBorrowingFeeFloor(1000), "Caller is not from timelock");
    await assertRevert(systemState.setRedemptionFeeFloor(1000), "Caller is not from timelock");
  });

  it("Timelock - should add queue success", async () => {
    let now = await time.latest();
    let executeTime = now.add(minDelay).add(new BN("200")); // 200 second after min delay
    const newValue = defaultAbiCoder.encode(["uint"], [1000]);

    await timeLock.schedule(systemState.address, 0, newValue, newValue, newValue, executeTime, {
      from: owner
    });
    const id = await timeLock.hashOperation(systemState.address, 0, newValue, newValue, newValue, {
      from: owner
    });
    expect(await timeLock.isOperation(id)).to.be.eq(true);
  });

  it("Timelock - should cancel queue success", async () => {
    let now = await time.latest();
    let executeTime = now.add(minDelay).add(new BN("200")); // 200 second after min delay
    const newValue = defaultAbiCoder.encode(["uint"], [1000]);

    await timeLock.schedule(systemState.address, 0, newValue, newValue, newValue, executeTime, {
      from: owner
    });
    const id = await timeLock.hashOperation(systemState.address, 0, newValue, newValue, newValue, {
      from: owner
    });
    expect(await timeLock.isOperation(id)).to.be.eq(true);
    await timeLock.cancel(id, { from: owner });
    expect(await timeLock.isOperation(id)).to.be.eq(false);
  });

  it("Timelock - should execute queue success - setLUSDGasCompensation", async () => {
    let executeTime = minDelay.add(new BN("200")); // 200 second after min delay
    const iface = new Interface(["function setLUSDGasCompensation(uint)"]);
    const newValue = iface.encodeFunctionData("setLUSDGasCompensation", [1000]);
    const zeroBytes = defaultAbiCoder.encode(["uint"], [0]);
    await timeLock.schedule(systemState.address, 0, newValue, zeroBytes, zeroBytes, executeTime, {
      from: owner
    });
    const id = await timeLock.hashOperation(systemState.address, 0, newValue, zeroBytes, zeroBytes, {
      from: owner
    });
    expect(await timeLock.isOperation(id)).to.be.eq(true);
    await time.increase(Number(executeTime) + 1);
    await timeLock.execute(systemState.address, 0, newValue, zeroBytes, zeroBytes, { from: owner, value : 1000 });
    expect(await systemState.getLUSDGasCompensation()).to.be.bignumber.equal((1000).toString());
  });

  it("Timelock - should execute queue success - setMCR", async () => {
    let executeTime = minDelay.add(new BN("200")); // 200 second after min delay
    const iface = new Interface(["function setMCR(uint)"]);
    const newValue = iface.encodeFunctionData("setMCR", [1000]);
    const zeroBytes = defaultAbiCoder.encode(["uint"], [0]);
    await timeLock.schedule(systemState.address, 0, newValue, zeroBytes, zeroBytes, executeTime, {
      from: owner
    });
    const id = await timeLock.hashOperation(systemState.address, 0, newValue, zeroBytes, zeroBytes, {
      from: owner
    });
    expect(await timeLock.isOperation(id)).to.be.eq(true);
    await time.increase(Number(executeTime) + 1);
    await timeLock.execute(systemState.address, 0, newValue, zeroBytes, zeroBytes, { from: owner });
    expect(await systemState.getMCR()).to.be.bignumber.equal((1000).toString());
  });

  it("Timelock - should execute queue success - setCCR", async () => {
    let executeTime = minDelay.add(new BN("200")); // 200 second after min delay
    const iface = new Interface(["function setCCR(uint)"]);
    const newValue = iface.encodeFunctionData("setCCR", [1000]);
    const zeroBytes = defaultAbiCoder.encode(["uint"], [0]);
    await timeLock.schedule(systemState.address, 0, newValue, zeroBytes, zeroBytes, executeTime, {
      from: owner
    });
    const id = await timeLock.hashOperation(systemState.address, 0, newValue, zeroBytes, zeroBytes, {
      from: owner
    });
    expect(await timeLock.isOperation(id)).to.be.eq(true);
    await time.increase(Number(executeTime) + 1);
    await timeLock.execute(systemState.address, 0, newValue, zeroBytes, zeroBytes, { from: owner });
    expect(await systemState.getCCR()).to.be.bignumber.equal((1000).toString());
  });

  it("Timelock - should execute queue success - setBorrowingFeeFloor", async () => {
    let executeTime = minDelay.add(new BN("200")); // 200 second after min delay
    const iface = new Interface(["function setBorrowingFeeFloor(uint)"]);
    const newValue = iface.encodeFunctionData("setBorrowingFeeFloor", [1000]);
    const zeroBytes = defaultAbiCoder.encode(["uint"], [0]);
    await timeLock.schedule(systemState.address, 0, newValue, zeroBytes, zeroBytes, executeTime, {
      from: owner
    });
    const id = await timeLock.hashOperation(systemState.address, 0, newValue, zeroBytes, zeroBytes, {
      from: owner
    });
    expect(await timeLock.isOperation(id)).to.be.eq(true);
    await time.increase(Number(executeTime) + 1);
    await timeLock.execute(systemState.address, 0, newValue, zeroBytes, zeroBytes, { from: owner });
    expect(await systemState.getBorrowingFeeFloor()).to.be.bignumber.equal((1000).toString());
  });

  it("Timelock - should execute queue success - setRedemptionFeeFloor", async () => {
    let executeTime = minDelay.add(new BN("200")); // 200 second after min delay
    const iface = new Interface(["function setRedemptionFeeFloor(uint)"]);
    const newValue = iface.encodeFunctionData("setRedemptionFeeFloor", [1000]);
    const zeroBytes = defaultAbiCoder.encode(["uint"], [0]);
    await timeLock.schedule(systemState.address, 0, newValue, zeroBytes, zeroBytes, executeTime, {
      from: owner
    });
    const id = await timeLock.hashOperation(systemState.address, 0, newValue, zeroBytes, zeroBytes, {
      from: owner
    });
    expect(await timeLock.isOperation(id)).to.be.eq(true);
    await time.increase(Number(executeTime) + 1);
    await timeLock.execute(systemState.address, 0, newValue, zeroBytes, zeroBytes, { from: owner });
    expect(await systemState.getRedemptionFeeFloor()).to.be.bignumber.equal((1000).toString());
  });

  it("Timelock - should execute queue success - setMinNetDebt", async () => {
    let executeTime = minDelay.add(new BN("200")); // 200 second after min delay
    const iface = new Interface(["function setMinNetDebt(uint)"]);
    const newValue = iface.encodeFunctionData("setMinNetDebt", [1000]);
    const zeroBytes = defaultAbiCoder.encode(["uint"], [0]);
    await timeLock.schedule(systemState.address, 0, newValue, zeroBytes, zeroBytes, executeTime, {
      from: owner
    });
    const id = await timeLock.hashOperation(systemState.address, 0, newValue, zeroBytes, zeroBytes, {
      from: owner
    });
    expect(await timeLock.isOperation(id)).to.be.eq(true);
    await time.increase(Number(executeTime) + 1);
    await timeLock.execute(systemState.address, 0, newValue, zeroBytes, zeroBytes, { from: owner });
    expect(await systemState.getMinNetDebt()).to.be.bignumber.equal((1000).toString());
  });

  it("Timelock - should execute queue success - setRewardPerBlock", async () => {
    let executeTime = minDelay.add(new BN("200")); // 200 second after min delay
    const iface = new Interface(["function setRewardsPerBlock(uint)"]);
    const newValue = iface.encodeFunctionData("setRewardsPerBlock", [2e18.toString()]);
    const zeroBytes = defaultAbiCoder.encode(["uint"], [0]);
    await timeLock.schedule(stabilityPool.address, 0, newValue, zeroBytes, zeroBytes, executeTime, {
      from: owner
    });
    const id = await timeLock.hashOperation(stabilityPool.address, 0, newValue, zeroBytes, zeroBytes, {
      from: owner
    });
    expect(await timeLock.isOperation(id)).to.be.eq(true);
    await time.increase(Number(executeTime) + 1);
    await timeLock.execute(stabilityPool.address, 0, newValue, zeroBytes, zeroBytes, { from: owner });
    expect(await stabilityPool.getRewarsPerBlock()).to.be.bignumber.equal((2e18).toString());
  });

  it("Timelock - should execute queue failed - Timestamp not passed", async () => {
    let executeTime = minDelay.add(new BN("200")); // 200 second after min delay
    const iface = new Interface(["function setLUSDGasCompensation(uint)"]);
    const newValue = iface.encodeFunctionData("setLUSDGasCompensation", [1000]);
    const zeroBytes = defaultAbiCoder.encode(["uint"], [0]);
    await timeLock.schedule(systemState.address, 0, newValue, zeroBytes, zeroBytes, executeTime, {
      from: owner
    });
    const id = await timeLock.hashOperation(systemState.address, 0, newValue, zeroBytes, zeroBytes, {
      from: owner
    });
    expect(await timeLock.isOperation(id)).to.be.eq(true);
    await time.increase(Number(executeTime) - 10);
    await assertRevert(
      timeLock.execute(systemState.address, 0, newValue, zeroBytes, zeroBytes, { from: owner }),
      "Timestamp not passed"
    );
  });

});
