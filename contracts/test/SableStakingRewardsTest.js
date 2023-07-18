const Decimal = require("decimal.js");
const deploymentHelper = require("../utils/deploymentHelpers.js");
const { BNConverter } = require("../utils/BNConverter.js");
const testHelpers = require("../utils/testHelpers.js");

const TroveManagerTester = artifacts.require("TroveManagerTester");
const NonPayable = artifacts.require("./NonPayable.sol");

const th = testHelpers.TestHelper;
const dec = th.dec;
const assertRevert = th.assertRevert;

const toBN = th.toBN;

/* NOTE: These tests do not test for specific BNB and USDS gain values. They only test that the
 * gains are non-zero, occur when they should, and are in correct proportion to the user's stake.
 *
 * Specific BNB/USDS gain values will depend on the final fee schedule used, and the final choices for
 * parameters BETA and MINUTE_DECAY_FACTOR in the TroveManager, which are still TBD based on economic
 * modelling.
 *
 */

contract("SABLEStaking revenue share tests", async accounts => {
  const [vaultAddress, lpRewardsAddress, multisig] = accounts.slice(997, 1000);

  const [owner, A, B, C, D, E, F, G, whale, funder] = accounts;

  let priceFeed;
  let usdsToken;
  let sortedTroves;
  let troveManager;
  let activePool;
  let stabilityPool;
  let defaultPool;
  let borrowerOperations;
  let sableStaking;
  let sableToken;
  let sableRewarder;
  let troveHelper;
  let mockSableLP;

  let contracts;

  const openTrove = async params => th.openTrove(contracts, params);

  const MINT_AMOUNT = toBN(dec(100000000, 18));

  beforeEach(async () => {
    contracts = await deploymentHelper.deployLiquityCore();
    contracts.troveManager = await TroveManagerTester.new();
    contracts = await deploymentHelper.deployUSDSTokenTester(contracts);
    const SABLEContracts = await deploymentHelper.deploySABLETesterContractsHardhat(
      vaultAddress,
      MINT_AMOUNT
    );
    mockSableLP = await deploymentHelper.deployMockSableLP(vaultAddress, MINT_AMOUNT);

    await deploymentHelper.connectCoreContracts(contracts, SABLEContracts);
    await deploymentHelper.connectSABLEContractsToCore(SABLEContracts, contracts);

    nonPayable = await NonPayable.new();
    priceFeed = contracts.priceFeedTestnet;
    usdsToken = contracts.usdsToken;
    sortedTroves = contracts.sortedTroves;
    troveManager = contracts.troveManager;
    activePool = contracts.activePool;
    stabilityPool = contracts.stabilityPool;
    defaultPool = contracts.defaultPool;
    borrowerOperations = contracts.borrowerOperations;
    hintHelpers = contracts.hintHelpers;
    troveHelper = contracts.troveHelper;

    sableToken = SABLEContracts.sableToken;
    sableStaking = SABLEContracts.sableStaking;
    sableRewarder = SABLEContracts.sableRewarder;

    // funding PriceFeed contract
    await web3.eth.sendTransaction({ from: funder, to: priceFeed.address, value: 1000000000 });
  });

  it("stake(): reverts if sableLPAddress is not set", async () => {
    // vaultAddress transfers SABLE to staker A
    await mockSableLP.transfer(A, dec(100, 18), { from: vaultAddress });

    // A makes stake
    await mockSableLP.approve(sableStaking.address, dec(100, 18), { from: A });
    await assertRevert(sableStaking.stake(0, { from: A }), "SableStaking: Staking not ready");
  });

  it("unstake(): Returns the staker's correct pending SABLE gain", async () => {
    // setting SableStakingV2 LP token address to Sable token address to initialize staking and allow Sable token deposit
    await sableStaking.setSableLPAddress(mockSableLP.address, { from: owner });
    await sableToken.transfer(sableRewarder.address, dec(1000000, 18), { from: vaultAddress });
    const rewardPerSec = 1;
    await sableRewarder.updateRewardPerSec(dec(rewardPerSec, 18), { from: owner });

    // vaultAddress transfers SABLE to staker A
    await mockSableLP.transfer(A, dec(100, 18), { from: vaultAddress });

    // A makes stake
    await mockSableLP.approve(sableStaking.address, dec(100, 18), { from: A });
    await sableStaking.stake(dec(100, 18), { from: A });

    const A_BalBeforeStake = await sableToken.balanceOf(A);
    assert.equal(A_BalBeforeStake, "0");
    const timeAfterStake = await sableRewarder.lastIssuanceTime();

    // FF time 1 day to generate some meaningful rewards
    await th.fastForwardTime(86400, web3.currentProvider);

    await sableStaking.unstake(dec(100, 18), { from: A });
    const A_BalAfterStake = await sableToken.balanceOf(A);
    const timeAfterClaim = await sableRewarder.lastIssuanceTime();
    const A_StakingPeriod = timeAfterClaim - timeAfterStake;
    assert.isTrue(toBN(dec(A_StakingPeriod * rewardPerSec, 18)).eq(A_BalAfterStake));
  });

  it("stake(): Top-up sends out all accumulated SABLE gains to the staker", async () => {
    // setting SableStakingV2 LP token address to Sable token address to initialize staking and allow Sable token deposit
    await sableStaking.setSableLPAddress(mockSableLP.address, { from: owner });
    await sableToken.transfer(sableRewarder.address, dec(1000000, 18), { from: vaultAddress });
    const rewardPerSec = 1;
    await sableRewarder.updateRewardPerSec(dec(rewardPerSec, 18), { from: owner });

    // vaultAddress transfers SABLE to staker A
    await mockSableLP.transfer(A, dec(100, 18), { from: vaultAddress });

    // A makes stake
    await mockSableLP.approve(sableStaking.address, dec(100, 18), { from: A });
    await sableStaking.stake(dec(100, 18), { from: A });

    const A_BalBeforeStake = await sableToken.balanceOf(A);
    assert.equal(A_BalBeforeStake, "0");
    const timeAfterStake = await sableRewarder.lastIssuanceTime();

    // FF time 1 day to generate some meaningful rewards
    await th.fastForwardTime(86400, web3.currentProvider);

    await mockSableLP.transfer(A, dec(10, 18), { from: vaultAddress });
    await mockSableLP.approve(sableStaking.address, dec(10, 18), { from: A });
    await sableStaking.stake(dec(10, 18), { from: A });
    const A_BalAfterStake = await sableToken.balanceOf(A);
    const timeAfterClaim = await sableRewarder.lastIssuanceTime();
    const A_StakingPeriod = timeAfterClaim - timeAfterStake;
    assert.isTrue(toBN(dec(A_StakingPeriod * rewardPerSec, 18)).eq(A_BalAfterStake));
  });

  it("getPendingSABLEGain(): Returns the staker's correct pending SABLE gain", async () => {
    // setting SableStakingV2 LP token address to Sable token address to initialize staking and allow Sable token deposit
    await sableStaking.setSableLPAddress(mockSableLP.address, { from: owner });
    await sableToken.transfer(sableRewarder.address, dec(1000000, 18), { from: vaultAddress });
    const rewardPerSec = 1;
    await sableRewarder.updateRewardPerSec(dec(rewardPerSec, 18), { from: owner });

    // vaultAddress transfers SABLE to staker A
    await mockSableLP.transfer(A, dec(100, 18), { from: vaultAddress });

    // A makes stake
    await mockSableLP.approve(sableStaking.address, dec(100, 18), { from: A });
    await sableStaking.stake(dec(100, 18), { from: A });

    const A_BalBeforeStake = await sableToken.balanceOf(A);
    assert.equal(A_BalBeforeStake, "0");

    // FF time 1 day to generate some meaningful rewards
    const timeToFastForward = 86400;
    await th.fastForwardTime(timeToFastForward, web3.currentProvider);

    // Trigger issuance event through updating reward per sec rate
    await sableRewarder.updateRewardPerSec(dec(rewardPerSec, 18), { from: owner });

    const A_PendingSable = await sableStaking.getPendingSABLEGain(A);
    const A_ExpectedSable = toBN(dec(timeToFastForward * rewardPerSec, 18));
    assert.isAtMost(th.getDifferenceBN(A_PendingSable, A_ExpectedSable), Number(dec(5, 18)));
  });

  it("getPendingSABLEGain(): Multi staker returns stakers' correct pending SABLE gain", async () => {
    // setting SableStakingV2 LP token address to Sable token address to initialize staking and allow Sable token deposit
    await sableStaking.setSableLPAddress(mockSableLP.address, { from: owner });
    await sableToken.transfer(sableRewarder.address, dec(1000000, 18), { from: vaultAddress });
    const rewardPerSec = 1;
    await sableRewarder.updateRewardPerSec(dec(rewardPerSec, 18), { from: owner });

    // vaultAddress transfers SABLE to staker A
    await mockSableLP.transfer(A, dec(100, 18), { from: vaultAddress });

    // A makes stake
    await mockSableLP.approve(sableStaking.address, dec(100, 18), { from: A });
    await sableStaking.stake(dec(100, 18), { from: A });

    const A_BalBeforeStake = await sableToken.balanceOf(A);
    assert.equal(A_BalBeforeStake, "0");

    // FF time 1 day to generate some meaningful rewards
    const timeToFastForward = 86400;
    await th.fastForwardTime(timeToFastForward, web3.currentProvider);

    // vaultAddress transfers SABLE to staker B
    await mockSableLP.transfer(B, dec(100, 18), { from: vaultAddress });

    // B makes stake to trigger issuance
    await mockSableLP.approve(sableStaking.address, dec(100, 18), { from: B });
    await sableStaking.stake(dec(100, 18), { from: B });

    // FF time 1 day to generate some more meaningful rewards
    await th.fastForwardTime(timeToFastForward, web3.currentProvider);

    // vaultAddress transfers SABLE to staker C
    await mockSableLP.transfer(C, dec(200, 18), { from: vaultAddress });

    // C makes stake to trigger issuance
    await mockSableLP.approve(sableStaking.address, dec(200, 18), { from: C });
    await sableStaking.stake(dec(200, 18), { from: C });

    // FF time 1 day to generate some more meaningful rewards
    await th.fastForwardTime(timeToFastForward, web3.currentProvider);

    // A triggers issuance by claiming
    await sableStaking.unstake(0, { from: A });

    /*
    New reward claimed by A = 86400 * (100/100) + 86400 * (100/200) + 86400 * (100/400) = 151200
    Pending reward B = 86400 * (0/100) + 86400 * (100/200) + 86400 * (100/400) = 64800
    Pending reward C = 86400 * (0/100) + 86400 * (0/200) + 86400 * (200/400) = 43200
    */

    const A_BalAfterClaim = await sableToken.balanceOf(A);
    const B_PendingSable = await sableStaking.getPendingSABLEGain(B);
    const C_PendingSable = await sableStaking.getPendingSABLEGain(C);
    assert.isAtMost(th.getDifferenceBN(A_BalAfterClaim, toBN(dec(151200, 18))), Number(dec(10, 18)));
    assert.isAtMost(th.getDifferenceBN(B_PendingSable, toBN(dec(64800, 18))), Number(dec(10, 18)));
    assert.isAtMost(th.getDifferenceBN(C_PendingSable, toBN(dec(43200, 18))), Number(dec(10, 18)));

    // B unstakes all
    await sableStaking.unstake(dec(100, 18), { from: B });

    // FF time 1 day to generate some more meaningful rewards
    await th.fastForwardTime(timeToFastForward, web3.currentProvider);

    // A triggers issuance by claiming
    await sableStaking.unstake(0, { from: A });

    /*
    New reward claimed by A = 86400 * (100/300) = 28800
    Pending reward B = 0
    Pending reward C = 43200 + 86400 * (200/300) = 100800
    */

    const A_NewBal = await sableToken.balanceOf(A);
    const A_NewRewardsAfterClaim2 = A_NewBal.sub(A_BalAfterClaim);
    const B_PendingSable2 = await sableStaking.getPendingSABLEGain(B);
    const C_PendingSable2 = await sableStaking.getPendingSABLEGain(C);
    assert.isAtMost(
      th.getDifferenceBN(A_NewRewardsAfterClaim2, toBN(dec(28800, 18))),
      Number(dec(10, 18))
    );
    assert.isTrue(B_PendingSable2.eq(toBN(0)));
    assert.isAtMost(th.getDifferenceBN(C_PendingSable2, toBN(dec(100800, 18))), Number(dec(10, 18)));
  });

  it("F_SABLE does not increase when no one is staking", async () => {
    // setting SableStakingV2 LP token address to Sable token address to initialize staking and allow Sable token deposit
    await sableStaking.setSableLPAddress(mockSableLP.address, { from: owner });
    await sableToken.transfer(sableRewarder.address, dec(1000000, 18), { from: vaultAddress });
    const rewardPerSec = 1;
    await sableRewarder.updateRewardPerSec(dec(rewardPerSec, 18), { from: owner });

    const F_SABLE_AtDeploy = await sableStaking.F_SABLE();
    assert.equal(F_SABLE_AtDeploy, "0");

    // FF time 1 day to generate some meaningful rewards
    const timeToFastForward = 86400;
    await th.fastForwardTime(timeToFastForward, web3.currentProvider);

    const F_SABLE_AfterOneDay = await sableStaking.F_SABLE();
    assert.equal(F_SABLE_AfterOneDay, "0");
  });

  it("F_SABLE increase correctly when staked > 0", async () => {
    // setting SableStakingV2 LP token address to Sable token address to initialize staking and allow Sable token deposit
    await sableStaking.setSableLPAddress(mockSableLP.address, { from: owner });
    await sableToken.transfer(sableRewarder.address, dec(1000000, 18), { from: vaultAddress });
    const rewardPerSec = 1;
    await sableRewarder.updateRewardPerSec(dec(rewardPerSec, 18), { from: owner });

    const F_SABLE_AtDeploy = await sableStaking.F_SABLE();
    assert.equal(F_SABLE_AtDeploy, "0");

    // vaultAddress transfers SABLE to staker A
    await mockSableLP.transfer(A, dec(100, 18), { from: vaultAddress });

    // A makes stake
    await mockSableLP.approve(sableStaking.address, dec(100, 18), { from: A });
    await sableStaking.stake(dec(100, 18), { from: A });

    // FF time 1 day to generate some meaningful rewards
    const timeToFastForward = 86400;
    await th.fastForwardTime(timeToFastForward, web3.currentProvider);

    // Trigger issuance event through updating reward per sec rate
    await sableRewarder.updateRewardPerSec(dec(rewardPerSec, 18), { from: owner });

    const F_SABLE_AfterOneDay = await sableStaking.F_SABLE();
    const totalSableLPStaked = await sableStaking.totalSableLPStaked();
    assert.isTrue(totalSableLPStaked.eq(toBN(dec(100, 18))));

    // expected F_SABLE: (86400 * 1) / 100 = 864
    const expectedF_SABLE =
      (timeToFastForward * rewardPerSec) / Number(totalSableLPStaked / 10 ** 18);
    assert.isTrue(F_SABLE_AfterOneDay.gt(toBN(0)));
    assert.isAtMost(
      th.getDifferenceBN(F_SABLE_AfterOneDay, toBN(dec(expectedF_SABLE, 18))),
      Number(dec(5, 18))
    );
  });

  it("F_SABLE increases correctly when more LP are staked over time given constant rewardPerSec", async () => {
    // setting SableStakingV2 LP token address to Sable token address to initialize staking and allow Sable token deposit
    await sableStaking.setSableLPAddress(mockSableLP.address, { from: owner });
    await sableToken.transfer(sableRewarder.address, dec(1000000, 18), { from: vaultAddress });
    const rewardPerSec = 1;
    await sableRewarder.updateRewardPerSec(dec(rewardPerSec, 18), { from: owner });

    // vaultAddress transfers SABLE to staker A
    await mockSableLP.transfer(A, dec(100, 18), { from: vaultAddress });

    // A makes stake
    await mockSableLP.approve(sableStaking.address, dec(100, 18), { from: A });
    await sableStaking.stake(dec(100, 18), { from: A });

    // F_SABLE should be zero
    const F_SABLE_Initial = Number(await sableStaking.F_SABLE());
    assert.equal(F_SABLE_Initial, 0);

    const totalSableLP_AfterAStaked = await sableStaking.totalSableLPStaked();

    // FF time 1 day to generate some meaningful rewards
    const timeToFastForward = 86400;
    await th.fastForwardTime(timeToFastForward, web3.currentProvider);

    // triggers rewards issuance that increases F_SABLE
    await sableStaking.unstake(dec(0, 18), { from: A });

    F_SABLE_AfterOneDay = await sableStaking.F_SABLE();
    // F_SABLE should be: 0 + (86400 * 1) / 100 = 864
    const expectedF_SABLE_AfterOneDay =
      F_SABLE_Initial +
      (timeToFastForward * rewardPerSec) / Number(totalSableLP_AfterAStaked / 10 ** 18);
    assert.isAtMost(
      th.getDifferenceBN(F_SABLE_AfterOneDay, toBN(dec(expectedF_SABLE_AfterOneDay, 18))),
      Number(dec(5, 18))
    );

    // vaultAddress transfers SABLE to staker B
    await mockSableLP.transfer(B, dec(100, 18), { from: vaultAddress });

    // B makes stake
    await mockSableLP.approve(sableStaking.address, dec(100, 18), { from: B });
    await sableStaking.stake(dec(100, 18), { from: B });

    const totalSableLP_AfterBStaked = await sableStaking.totalSableLPStaked();

    // FF time 1 day to generate some meaningful rewards
    await th.fastForwardTime(timeToFastForward, web3.currentProvider);

    // triggers rewards issuance that increases F_SABLE
    await sableStaking.unstake(dec(0, 18), { from: A });

    F_SABLE_AfterTwoDays = await sableStaking.F_SABLE();
    // F_SABLE should be: 864 + (86400 * 1) / 200 = 1296
    const expectedF_SABLE_AfterTwoDays =
      expectedF_SABLE_AfterOneDay +
      (timeToFastForward * rewardPerSec) / Number(totalSableLP_AfterBStaked / 10 ** 18);
    assert.isAtMost(
      th.getDifferenceBN(F_SABLE_AfterTwoDays, toBN(dec(expectedF_SABLE_AfterTwoDays, 18))),
      Number(dec(5, 18))
    );

    // vaultAddress transfers SABLE to staker C
    await mockSableLP.transfer(C, dec(200, 18), { from: vaultAddress });

    // C makes stake
    await mockSableLP.approve(sableStaking.address, dec(200, 18), { from: C });
    await sableStaking.stake(dec(200, 18), { from: C });

    const totalSableLP_AfterCStaked = await sableStaking.totalSableLPStaked();

    // FF time 1 day to generate some more meaningful rewards
    await th.fastForwardTime(timeToFastForward, web3.currentProvider);

    // triggers rewards issuance that increases F_SABLE
    await sableStaking.unstake(dec(0, 18), { from: A });

    F_SABLE_AfterThreeDays = await sableStaking.F_SABLE();
    // F_SABLE should be: 1296 + (86400 * 1) / 400 = 1512
    const expectedF_SABLE_AfterThreeDays =
      expectedF_SABLE_AfterTwoDays +
      (timeToFastForward * rewardPerSec) / Number(totalSableLP_AfterCStaked / 10 ** 18);
    assert.isAtMost(
      th.getDifferenceBN(F_SABLE_AfterThreeDays, toBN(dec(expectedF_SABLE_AfterThreeDays, 18))),
      Number(dec(5, 18))
    );
  });

  it("(SableRewarder) issueSABLE(): reverts if not called by SableStaking", async () => {
    await assertRevert(
      sableRewarder.issueSABLE({ from: A }),
      "SableRewarder: caller is not Staking"
    );
  });
});
