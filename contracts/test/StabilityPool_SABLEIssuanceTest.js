const deploymentHelper = require("../utils/deploymentHelpers.js")
const testHelpers = require("../utils/testHelpers.js")

const th = testHelpers.TestHelper
const timeValues = testHelpers.TimeValues
const dec = th.dec
const toBN = th.toBN
const getDifference = th.getDifference
const DEFAULT_PRICE_FEED_DATA = testHelpers.DEFAULT_PRICE_FEED_DATA;

const TroveManagerTester = artifacts.require("TroveManagerTester")
const USDSToken = artifacts.require("USDSToken")

const GAS_PRICE = 10000000

contract('StabilityPool - SABLE Rewards', async accounts => {

  const [
    owner,
    whale,
    A, B, C, D, E, F, G, H,
    defaulter_1, defaulter_2, defaulter_3, defaulter_4, defaulter_5, defaulter_6,
    frontEnd_1, frontEnd_2, frontEnd_3
  ] = accounts;

  const [vaultAddress, lpRewardsAddress, multisig] = accounts.slice(997, 1000)

  let contracts

  let priceFeed
  let usdsToken
  let stabilityPool
  let sortedTroves
  let troveManager
  let borrowerOperations
  let sableToken
  let communityIssuanceTester

  let communitySABLESupply

  const ZERO_ADDRESS = th.ZERO_ADDRESS

  const getOpenTroveUSDSAmount = async (totalDebt) => th.getOpenTroveUSDSAmount(contracts, totalDebt)

  const openTrove = async (params) => th.openTrove(contracts, params)
  describe("SABLE Rewards", async () => {

    beforeEach(async () => {
      contracts = await deploymentHelper.deployLiquityCore()
      contracts.troveManager = await TroveManagerTester.new()
      contracts.usdsToken = await USDSToken.new(
        contracts.troveManager.address,
        contracts.stabilityPool.address,
        contracts.borrowerOperations.address
      )
      const MINT_AMOUNT = toBN(dec(100000000, 18))
      const SABLEContracts = await deploymentHelper.deploySABLETesterContractsHardhat(vaultAddress, MINT_AMOUNT)

      priceFeed = contracts.priceFeedTestnet
      usdsToken = contracts.usdsToken
      stabilityPool = contracts.stabilityPool
      sortedTroves = contracts.sortedTroves
      troveManager = contracts.troveManager
      stabilityPool = contracts.stabilityPool
      borrowerOperations = contracts.borrowerOperations

      sableToken = SABLEContracts.sableToken
      communityIssuanceTester = SABLEContracts.communityIssuance

      
      await deploymentHelper.connectCoreContracts(contracts, SABLEContracts)
      await deploymentHelper.connectSABLEContractsToCore(SABLEContracts, contracts)

      await sableToken.transfer(communityIssuanceTester.address, '32000000000000000000000000', {
        from: vaultAddress
      });

      // Check community issuance starts with 32 million SABLE
      communitySABLESupply = toBN(await sableToken.balanceOf(communityIssuanceTester.address))
      assert.isAtMost(getDifference(communitySABLESupply, '32000000000000000000000000'), 1000)
    })

    it("liquidation after a deposit does change totalSABLEIssued", async () => {
      let rewardPerSec = await communityIssuanceTester.latestRewardPerSec();
      
      await openTrove({ extraUSDSAmount: toBN(dec(10000, 18)), ICR: toBN(dec(2, 18)), extraParams: {from: A } })
      await openTrove({ extraUSDSAmount: toBN(dec(10000, 18)), ICR: toBN(dec(2, 18)), extraParams: {from: B } })

      // A, B provide to SP
      await stabilityPool.provideToSP(dec(10000, 18), ZERO_ADDRESS, { from: A })
      await stabilityPool.provideToSP(dec(5000, 18), ZERO_ADDRESS, { from: B })

      await th.fastForwardTime(timeValues.SECONDS_IN_ONE_MINUTE, web3.currentProvider)

      await priceFeed.setPrice(dec(105, 18))

      // B adjusts, triggering SABLE issuance for all
      await stabilityPool.provideToSP(dec(5000, 18), ZERO_ADDRESS, { from: B })
      const blockTimestamp_1 = th.toBN(await th.getLatestBlockTimestamp(web3))
      let B_pendingSABLEGain = await stabilityPool.getDepositorSABLEGain(B);
      assert.equal(B_pendingSABLEGain, '0')

      // Check SABLE has been issued
      const totalSABLEIssued_1 = await communityIssuanceTester.totalSABLEIssued()
      assert.isTrue(totalSABLEIssued_1.gt(toBN('0')))
      
      await troveManager.liquidate(B, DEFAULT_PRICE_FEED_DATA)
      const blockTimestamp_2 = th.toBN(await th.getLatestBlockTimestamp(web3))

      assert.isFalse(await sortedTroves.contains(B))

      const totalSABLEIssued_2 = await communityIssuanceTester.totalSABLEIssued()

      //console.log(`totalSABLEIssued_1: ${totalSABLEIssued_1}`)
      //console.log(`totalSABLEIssued_2: ${totalSABLEIssued_2}`)

      // check blockTimestamp diff < 60s
      const timestampDiff = blockTimestamp_2.sub(blockTimestamp_1)

      // Check that the liquidation did alter total SABLE issued
      assert.isTrue(totalSABLEIssued_2.gt(totalSABLEIssued_1))

      // Check that depositor B has no SABLE gain
      B_pendingSABLEGain = await stabilityPool.getDepositorSABLEGain(B)
      let B_pendingSABLEGainExpected = rewardPerSec.div(toBN(2)).mul(toBN(timestampDiff))
      assert.equal(Number(B_pendingSABLEGainExpected), Number(B_pendingSABLEGain));

      // Check depositor B has a pending BNB gain
      const B_pendingBNBGain = await stabilityPool.getDepositorBNBGain(B)
      assert.isTrue(B_pendingBNBGain.gt(toBN('0')))
    })

    it("withdrawFromSP(): reward term G update when new SABLE is issued", async () => {
      await borrowerOperations.openTrove(th._100pct, dec(10000, 18), A, A, DEFAULT_PRICE_FEED_DATA, { from: A, value: dec(1000, 'ether') })
      await stabilityPool.provideToSP(dec(10000, 18), ZERO_ADDRESS, { from: A })

      const A_initialDeposit = ((await stabilityPool.deposits(A))[0]).toString()
      assert.equal(A_initialDeposit, dec(10000, 18))

      // defaulter opens trove
      await borrowerOperations.openTrove(th._100pct, await getOpenTroveUSDSAmount(dec(10000, 18)), defaulter_1, defaulter_1, DEFAULT_PRICE_FEED_DATA, { from: defaulter_1, value: dec(100, 'ether') })

      // BNB drops
      await priceFeed.setPrice(dec(100, 18))

      await th.fastForwardTime(timeValues.SECONDS_IN_ONE_MINUTE, web3.currentProvider)

      // Liquidate d1. Triggers issuance.
      await troveManager.liquidate(defaulter_1, DEFAULT_PRICE_FEED_DATA)
      assert.isFalse(await sortedTroves.contains(defaulter_1))

      // Get G and communityIssuance before
      const G_Before = await stabilityPool.epochToScaleToG(0, 0)
      const SABLEIssuedBefore = await communityIssuanceTester.totalSABLEIssued()

      //  A withdraws some deposit. Triggers issuance.
      const tx = await stabilityPool.withdrawFromSP(1000, DEFAULT_PRICE_FEED_DATA, { from: A, gasPrice: GAS_PRICE })
      assert.isTrue(tx.receipt.status)

      const G_After = await stabilityPool.epochToScaleToG(1, 0)
      const SABLEIssuedAfter = await communityIssuanceTester.totalSABLEIssued()

      assert.isTrue(G_After.gt(G_Before))
      assert.isTrue(SABLEIssuedAfter.gt(SABLEIssuedBefore))
    })

    // using the result of this to advance time by the desired amount from the deployment time, whether or not some extra time has passed in the meanwhile
    const getDuration = async (expectedDuration) => {
      const deploymentTime = (await communityIssuanceTester.deploymentTime()).toNumber()
      const currentTime = await th.getLatestBlockTimestamp(web3)
      const duration = Math.max(expectedDuration - (currentTime - deploymentTime), 0)

      return duration
    }

    it("Owner can update latestRewardPerSec in CommunityIssuance contract", async () => {
      let rewardPerSec = await communityIssuanceTester.latestRewardPerSec();
      assert.equal(rewardPerSec.toString(), dec(1, 18));

      await communityIssuanceTester.updateRewardPerSec(dec(2, 18), { from: owner });
      rewardPerSec = await communityIssuanceTester.latestRewardPerSec();
      assert.equal(rewardPerSec.toString(), dec(2, 18));
    })

    // Simple case: 3 depositors, equal stake. No liquidations. No front-end.
    it("withdrawFromSP(): Depositors with equal initial deposit withdraw correct SABLE gain. No liquidations. No front end.", async () => {
      const initialIssuance = await communityIssuanceTester.totalSABLEIssued()
      assert.equal(initialIssuance, 0)
      let rewardPerSec = await communityIssuanceTester.latestRewardPerSec();

      // Whale opens Trove with 10k BNB
      await borrowerOperations.openTrove(th._100pct, dec(10000, 18), whale, whale, DEFAULT_PRICE_FEED_DATA, { from: whale, value: dec(10000, 'ether') })

      await borrowerOperations.openTrove(th._100pct, dec(1, 22), A, A, DEFAULT_PRICE_FEED_DATA, { from: A, value: dec(100, 'ether') })
      await borrowerOperations.openTrove(th._100pct, dec(1, 22), B, B, DEFAULT_PRICE_FEED_DATA, { from: B, value: dec(100, 'ether') })
      await borrowerOperations.openTrove(th._100pct, dec(1, 22), C, C, DEFAULT_PRICE_FEED_DATA, { from: C, value: dec(100, 'ether') })
      await borrowerOperations.openTrove(th._100pct, dec(1, 22), D, D, DEFAULT_PRICE_FEED_DATA, { from: D, value: dec(100, 'ether') })

      // Check all SABLE balances are initially 0
      assert.equal(await sableToken.balanceOf(A), 0)
      assert.equal(await sableToken.balanceOf(B), 0)
      assert.equal(await sableToken.balanceOf(C), 0)

      // A, B, C deposit
      await stabilityPool.provideToSP(dec(1, 22), ZERO_ADDRESS, { from: A })
      await stabilityPool.provideToSP(dec(1, 22), ZERO_ADDRESS, { from: B })
      await stabilityPool.provideToSP(dec(1, 22), ZERO_ADDRESS, { from: C })
      let blockTimestamp_1 = th.toBN(await th.getLatestBlockTimestamp(web3))

      // One minute passes
      await th.fastForwardTime(timeValues.SECONDS_IN_ONE_MINUTE, web3.currentProvider)

      // owner update reward per sec to trigger SABLE gains for A, B, C.
      await communityIssuanceTester.updateRewardPerSec(dec(1, 18), { from: owner});

      let blockTimestamp_2 = th.toBN(await th.getLatestBlockTimestamp(web3))
      let timestampDiff = blockTimestamp_2.sub(blockTimestamp_1)

      // Check SABLE gain
      const A_SABLEGain_1min = await stabilityPool.getDepositorSABLEGain(A)
      const A_SABLEGain_1min_expected = rewardPerSec.add(rewardPerSec.div(toBN(2))).add(rewardPerSec.div(toBN(3)).mul(timestampDiff));
      const B_SABLEGain_1min = await stabilityPool.getDepositorSABLEGain(B)
      const B_SABLEGain_1min_expected = (rewardPerSec.div(toBN(2))).add(rewardPerSec.div(toBN(3)).mul(timestampDiff));
      const C_SABLEGain_1min = await stabilityPool.getDepositorSABLEGain(C)
      const C_SABLEGain_1min_expected = rewardPerSec.div(toBN(3)).mul(timestampDiff);
      // Check gains are correct, error tolerance = 1e-6 of a token

      assert.isAtMost(getDifference(A_SABLEGain_1min, A_SABLEGain_1min_expected), 1e12)
      assert.isAtMost(getDifference(B_SABLEGain_1min, B_SABLEGain_1min_expected), 1e12)
      assert.isAtMost(getDifference(C_SABLEGain_1min, C_SABLEGain_1min_expected), 1e12)

      blockTimestamp_1 = th.toBN(await th.getLatestBlockTimestamp(web3))

      // Another minute passes
      await th.fastForwardTime(timeValues.SECONDS_IN_ONE_MINUTE, web3.currentProvider)

      // owner update reward per sec to trigger SABLE gains for A, B, C.
      await communityIssuanceTester.updateRewardPerSec(dec(1, 18), { from: owner});

      blockTimestamp_2 = th.toBN(await th.getLatestBlockTimestamp(web3))
      timestampDiff = blockTimestamp_2.sub(blockTimestamp_1)

      // Check SABLE gain
      const A_SABLEGain_2min = await stabilityPool.getDepositorSABLEGain(A)
      const A_SABLEGain_2min_expected = A_SABLEGain_1min.add(rewardPerSec.div(toBN(3)).mul(timestampDiff));
      const B_SABLEGain_2min = await stabilityPool.getDepositorSABLEGain(B)
      const B_SABLEGain_2min_expected = B_SABLEGain_1min.add(rewardPerSec.div(toBN(3)).mul(timestampDiff));
      const C_SABLEGain_2min = await stabilityPool.getDepositorSABLEGain(C)
      const C_SABLEGain_2min_expected = C_SABLEGain_1min.add(rewardPerSec.div(toBN(3)).mul(timestampDiff));

      // Check gains are correct, error tolerance = 1e-6 of a token
      assert.isAtMost(getDifference(A_SABLEGain_2min, A_SABLEGain_2min_expected), 1e12)
      assert.isAtMost(getDifference(B_SABLEGain_2min, B_SABLEGain_2min_expected), 1e12)
      assert.isAtMost(getDifference(C_SABLEGain_2min, C_SABLEGain_2min_expected), 1e12)

      // Each depositor fully withdraws
      let totalUSDSDeposits = await stabilityPool.getTotalUSDSDeposits();
      const A_CompoundedDeposit = await stabilityPool.getCompoundedUSDSDeposit(A);
      const B_CompoundedDeposit = await stabilityPool.getCompoundedUSDSDeposit(B);
      const C_CompoundedDeposit = await stabilityPool.getCompoundedUSDSDeposit(C);
      let A_SABLEGain_balance_expected = A_SABLEGain_2min_expected.add(rewardPerSec.mul(A_CompoundedDeposit).div(totalUSDSDeposits));
      let B_SABLEGain_balance_expected = B_SABLEGain_2min_expected.add(rewardPerSec.mul(B_CompoundedDeposit).div(totalUSDSDeposits));
      let C_SABLEGain_balance_expected = C_SABLEGain_2min_expected.add(rewardPerSec.mul(C_CompoundedDeposit).div(totalUSDSDeposits));
      await stabilityPool.withdrawFromSP(dec(100, 18), DEFAULT_PRICE_FEED_DATA, { from: A })
      assert.isAtMost(getDifference((await sableToken.balanceOf(A)), A_SABLEGain_balance_expected), 1e12);

      totalUSDSDeposits = await stabilityPool.getTotalUSDSDeposits();
      B_SABLEGain_balance_expected = B_SABLEGain_balance_expected.add(rewardPerSec.mul(B_CompoundedDeposit).div(totalUSDSDeposits));
      C_SABLEGain_balance_expected = C_SABLEGain_balance_expected.add(rewardPerSec.mul(C_CompoundedDeposit).div(totalUSDSDeposits));
      await stabilityPool.withdrawFromSP(dec(100, 18), DEFAULT_PRICE_FEED_DATA, { from: B })
      assert.isAtMost(getDifference((await sableToken.balanceOf(B)), B_SABLEGain_balance_expected), 1e12);

      totalUSDSDeposits = await stabilityPool.getTotalUSDSDeposits();
      C_SABLEGain_balance_expected = C_SABLEGain_balance_expected.add(rewardPerSec.mul(C_CompoundedDeposit).div(totalUSDSDeposits));
      await stabilityPool.withdrawFromSP(dec(100, 18), DEFAULT_PRICE_FEED_DATA, { from: C })
      assert.isAtMost(getDifference((await sableToken.balanceOf(C)), C_SABLEGain_balance_expected), 1e12);
    })

    // Simple case: 3 depositors, equal stake. No liquidations. No front-end. Update rewardPerSec
    it("withdrawFromSP(): Depositors with equal initial deposit withdraw correct SABLE gain. No liquidations. No front end. Update latestRewardPerSec", async () => {
      const initialIssuance = await communityIssuanceTester.totalSABLEIssued()
      assert.equal(initialIssuance, 0)
      let rewardPerSec = await communityIssuanceTester.latestRewardPerSec();

      // Whale opens Trove with 10k BNB
      await borrowerOperations.openTrove(th._100pct, dec(10000, 18), whale, whale, DEFAULT_PRICE_FEED_DATA, { from: whale, value: dec(10000, 'ether') })

      await borrowerOperations.openTrove(th._100pct, dec(1, 22), A, A, DEFAULT_PRICE_FEED_DATA, { from: A, value: dec(100, 'ether') })
      await borrowerOperations.openTrove(th._100pct, dec(1, 22), B, B, DEFAULT_PRICE_FEED_DATA, { from: B, value: dec(100, 'ether') })
      await borrowerOperations.openTrove(th._100pct, dec(1, 22), C, C, DEFAULT_PRICE_FEED_DATA, { from: C, value: dec(100, 'ether') })
      await borrowerOperations.openTrove(th._100pct, dec(1, 22), D, D, DEFAULT_PRICE_FEED_DATA, { from: D, value: dec(100, 'ether') })

      // Check all SABLE balances are initially 0
      assert.equal(await sableToken.balanceOf(A), 0)
      assert.equal(await sableToken.balanceOf(B), 0)
      assert.equal(await sableToken.balanceOf(C), 0)

      // A, B, C deposit
      await stabilityPool.provideToSP(dec(1, 22), ZERO_ADDRESS, { from: A })
      await stabilityPool.provideToSP(dec(1, 22), ZERO_ADDRESS, { from: B })
      await stabilityPool.provideToSP(dec(1, 22), ZERO_ADDRESS, { from: C })
      let blockTimestamp_1 = th.toBN(await th.getLatestBlockTimestamp(web3))

      // One minute passes
      await th.fastForwardTime(timeValues.SECONDS_IN_ONE_MINUTE, web3.currentProvider)

      // owner update reward per sec to trigger SABLE gains for A, B, C.
      await communityIssuanceTester.updateRewardPerSec(dec(2, 18), { from: owner});
      let oldRewardPerSec = rewardPerSec;
      rewardPerSec = await communityIssuanceTester.latestRewardPerSec();
      assert.equal(rewardPerSec.toString(), dec(2, 18));

      let blockTimestamp_2 = th.toBN(await th.getLatestBlockTimestamp(web3))
      let timestampDiff = blockTimestamp_2.sub(blockTimestamp_1)

      // Check SABLE gain
      const A_SABLEGain_1min = await stabilityPool.getDepositorSABLEGain(A)
      const A_SABLEGain_1min_expected = oldRewardPerSec.add(oldRewardPerSec.div(toBN(2))).add(oldRewardPerSec.div(toBN(3)).mul(timestampDiff));
      const B_SABLEGain_1min = await stabilityPool.getDepositorSABLEGain(B)
      const B_SABLEGain_1min_expected = (oldRewardPerSec.div(toBN(2))).add(oldRewardPerSec.div(toBN(3)).mul(timestampDiff));
      const C_SABLEGain_1min = await stabilityPool.getDepositorSABLEGain(C)
      const C_SABLEGain_1min_expected = oldRewardPerSec.div(toBN(3)).mul(timestampDiff);
      // Check gains are correct, error tolerance = 1e-6 of a token

      assert.isAtMost(getDifference(A_SABLEGain_1min, A_SABLEGain_1min_expected), 1e12)
      assert.isAtMost(getDifference(B_SABLEGain_1min, B_SABLEGain_1min_expected), 1e12)
      assert.isAtMost(getDifference(C_SABLEGain_1min, C_SABLEGain_1min_expected), 1e12)

      blockTimestamp_1 = th.toBN(await th.getLatestBlockTimestamp(web3))

      // Another minute passes
      await th.fastForwardTime(timeValues.SECONDS_IN_ONE_MINUTE, web3.currentProvider)

      // owner update reward per sec to trigger SABLE gains for A, B, C.
      await communityIssuanceTester.updateRewardPerSec(dec(2, 18), { from: owner});
      rewardPerSec = await communityIssuanceTester.latestRewardPerSec();
      assert.equal(rewardPerSec.toString(), dec(2, 18));

      blockTimestamp_2 = th.toBN(await th.getLatestBlockTimestamp(web3))
      timestampDiff = blockTimestamp_2.sub(blockTimestamp_1)

      // Check SABLE gain
      const A_SABLEGain_2min = await stabilityPool.getDepositorSABLEGain(A)
      const A_SABLEGain_2min_expected = A_SABLEGain_1min.add(rewardPerSec.div(toBN(3)).mul(timestampDiff));
      const B_SABLEGain_2min = await stabilityPool.getDepositorSABLEGain(B)
      const B_SABLEGain_2min_expected = B_SABLEGain_1min.add(rewardPerSec.div(toBN(3)).mul(timestampDiff));
      const C_SABLEGain_2min = await stabilityPool.getDepositorSABLEGain(C)
      const C_SABLEGain_2min_expected = C_SABLEGain_1min.add(rewardPerSec.div(toBN(3)).mul(timestampDiff));

      // Check gains are correct, error tolerance = 1e-6 of a token
      assert.isAtMost(getDifference(A_SABLEGain_2min, A_SABLEGain_2min_expected), 1e12)
      assert.isAtMost(getDifference(B_SABLEGain_2min, B_SABLEGain_2min_expected), 1e12)
      assert.isAtMost(getDifference(C_SABLEGain_2min, C_SABLEGain_2min_expected), 1e12)

      // Each depositor fully withdraws
      let totalUSDSDeposits = await stabilityPool.getTotalUSDSDeposits();
      const A_CompoundedDeposit = await stabilityPool.getCompoundedUSDSDeposit(A);
      const B_CompoundedDeposit = await stabilityPool.getCompoundedUSDSDeposit(B);
      const C_CompoundedDeposit = await stabilityPool.getCompoundedUSDSDeposit(C);
      let A_SABLEGain_balance_expected = A_SABLEGain_2min_expected.add(rewardPerSec.mul(A_CompoundedDeposit).div(totalUSDSDeposits));
      let B_SABLEGain_balance_expected = B_SABLEGain_2min_expected.add(rewardPerSec.mul(B_CompoundedDeposit).div(totalUSDSDeposits));
      let C_SABLEGain_balance_expected = C_SABLEGain_2min_expected.add(rewardPerSec.mul(C_CompoundedDeposit).div(totalUSDSDeposits));
      await stabilityPool.withdrawFromSP(dec(100, 18), DEFAULT_PRICE_FEED_DATA, { from: A })
      assert.isAtMost(getDifference((await sableToken.balanceOf(A)), A_SABLEGain_balance_expected), 1e12);

      totalUSDSDeposits = await stabilityPool.getTotalUSDSDeposits();
      B_SABLEGain_balance_expected = B_SABLEGain_balance_expected.add(rewardPerSec.mul(B_CompoundedDeposit).div(totalUSDSDeposits));
      C_SABLEGain_balance_expected = C_SABLEGain_balance_expected.add(rewardPerSec.mul(C_CompoundedDeposit).div(totalUSDSDeposits));
      await stabilityPool.withdrawFromSP(dec(100, 18), DEFAULT_PRICE_FEED_DATA, { from: B })
      assert.isAtMost(getDifference((await sableToken.balanceOf(B)), B_SABLEGain_balance_expected), 1e12);

      totalUSDSDeposits = await stabilityPool.getTotalUSDSDeposits();
      C_SABLEGain_balance_expected = C_SABLEGain_balance_expected.add(rewardPerSec.mul(C_CompoundedDeposit).div(totalUSDSDeposits));
      await stabilityPool.withdrawFromSP(dec(100, 18), DEFAULT_PRICE_FEED_DATA, { from: C })
      assert.isAtMost(getDifference((await sableToken.balanceOf(C)), C_SABLEGain_balance_expected), 1e12);
    })

    // 3 depositors, varied stake. No liquidations. No front-end.
    it("withdrawFromSP(): Depositors with varying initial deposit withdraw correct SABLE gain. No liquidations. No front end.", async () => {
      const initialIssuance = await communityIssuanceTester.totalSABLEIssued()
      assert.equal(initialIssuance, 0)

      let rewardPerSec = await communityIssuanceTester.latestRewardPerSec();

      // Whale opens Trove with 10k BNB
      await borrowerOperations.openTrove(th._100pct, await getOpenTroveUSDSAmount(dec(10000, 18)), whale, whale, DEFAULT_PRICE_FEED_DATA, { from: whale, value: dec(10000, 'ether') })

      await borrowerOperations.openTrove(th._100pct, dec(10000, 18), A, A, DEFAULT_PRICE_FEED_DATA, { from: A, value: dec(200, 'ether') })
      await borrowerOperations.openTrove(th._100pct, dec(20000, 18), B, B, DEFAULT_PRICE_FEED_DATA, { from: B, value: dec(300, 'ether') })
      await borrowerOperations.openTrove(th._100pct, dec(30000, 18), C, C, DEFAULT_PRICE_FEED_DATA, { from: C, value: dec(400, 'ether') })
      await borrowerOperations.openTrove(th._100pct, dec(10000, 18), D, D, DEFAULT_PRICE_FEED_DATA, { from: D, value: dec(100, 'ether') })

      // Check all SABLE balances are initially 0
      assert.equal(await sableToken.balanceOf(A), 0)
      assert.equal(await sableToken.balanceOf(B), 0)
      assert.equal(await sableToken.balanceOf(C), 0)

      // A, B, C deposit
      await stabilityPool.provideToSP(dec(10000, 18), ZERO_ADDRESS, { from: A })
      await stabilityPool.provideToSP(dec(20000, 18), ZERO_ADDRESS, { from: B })
      await stabilityPool.provideToSP(dec(30000, 18), ZERO_ADDRESS, { from: C })

      let blockTimestamp_1 = th.toBN(await th.getLatestBlockTimestamp(web3))

      // One minute passes
      await th.fastForwardTime(timeValues.SECONDS_IN_ONE_MINUTE, web3.currentProvider)

      // owner update reward per sec to trigger SABLE gains for A, B, C.
      await communityIssuanceTester.updateRewardPerSec(dec(1, 18), { from: owner});

      let blockTimestamp_2 = th.toBN(await th.getLatestBlockTimestamp(web3))
      let timestampDiff = blockTimestamp_2.sub(blockTimestamp_1)

      const A_expectedSABLEGain_1min = rewardPerSec.add(rewardPerSec.div(toBN(3))).add(rewardPerSec.div(toBN(6)).mul(timestampDiff))

      const B_expectedSABLEGain_1min = (rewardPerSec.mul(toBN(2)).div(toBN(3))).add(rewardPerSec.div(toBN(3)).mul(timestampDiff))

      const C_expectedSABLEGain_1min = rewardPerSec.div(toBN(2)).mul(timestampDiff)  

      // Check SABLE gain
      const A_SABLEGain_1min = await stabilityPool.getDepositorSABLEGain(A)
      const B_SABLEGain_1min = await stabilityPool.getDepositorSABLEGain(B)
      const C_SABLEGain_1min = await stabilityPool.getDepositorSABLEGain(C)

      // Check gains are correct, error tolerance = 1e-6 of a toke
      assert.isAtMost(getDifference(A_SABLEGain_1min, A_expectedSABLEGain_1min), 1e12)
      assert.isAtMost(getDifference(B_SABLEGain_1min, B_expectedSABLEGain_1min), 1e12)
      assert.isAtMost(getDifference(C_SABLEGain_1min, C_expectedSABLEGain_1min), 1e12)

      blockTimestamp_1 = th.toBN(await th.getLatestBlockTimestamp(web3))

      // Another minute passes
      await th.fastForwardTime(timeValues.SECONDS_IN_ONE_MINUTE, web3.currentProvider)

      // owner update reward per sec to trigger SABLE gains for A, B, C.
      await communityIssuanceTester.updateRewardPerSec(dec(1, 18), { from: owner});

      blockTimestamp_2 = th.toBN(await th.getLatestBlockTimestamp(web3))
      timestampDiff = blockTimestamp_2.sub(blockTimestamp_1)

      // Expected gains for each depositor after 2 minutes.
      const A_expectedSABLEGain_2min = A_SABLEGain_1min.add(rewardPerSec.div(toBN(6)).mul(timestampDiff))

      const B_expectedSABLEGain_2min = B_SABLEGain_1min.add(rewardPerSec.div(toBN(3)).mul(timestampDiff))

      const C_expectedSABLEGain_2min = C_SABLEGain_1min.add(rewardPerSec.div(toBN(2)).mul(timestampDiff))

      // Check SABLE gain
      const A_SABLEGain_2min = await stabilityPool.getDepositorSABLEGain(A)
      const B_SABLEGain_2min = await stabilityPool.getDepositorSABLEGain(B)
      const C_SABLEGain_2min = await stabilityPool.getDepositorSABLEGain(C)

      // Check gains are correct, error tolerance = 1e-6 of a token
      assert.isAtMost(getDifference(A_SABLEGain_2min, A_expectedSABLEGain_2min), 1e12)
      assert.isAtMost(getDifference(B_SABLEGain_2min, B_expectedSABLEGain_2min), 1e12)
      assert.isAtMost(getDifference(C_SABLEGain_2min, C_expectedSABLEGain_2min), 1e12)

      // Each depositor fully withdraws
      let totalUSDSDeposits = await stabilityPool.getTotalUSDSDeposits();
      const A_CompoundedDeposit = await stabilityPool.getCompoundedUSDSDeposit(A);
      const B_CompoundedDeposit = await stabilityPool.getCompoundedUSDSDeposit(B);
      const C_CompoundedDeposit = await stabilityPool.getCompoundedUSDSDeposit(C);

      const A_SABLEGain_balance_expected = A_expectedSABLEGain_2min.add(rewardPerSec.mul(A_CompoundedDeposit).div(totalUSDSDeposits));
      let B_SABLEGain_balance_expected = B_expectedSABLEGain_2min.add(rewardPerSec.mul(B_CompoundedDeposit).div(totalUSDSDeposits))
      let C_SABLEGain_balance_expected = C_expectedSABLEGain_2min.add(rewardPerSec.mul(C_CompoundedDeposit).div(totalUSDSDeposits))
      await stabilityPool.withdrawFromSP(dec(10000, 18), DEFAULT_PRICE_FEED_DATA, { from: A })
      assert.isAtMost(getDifference((await sableToken.balanceOf(A)), A_SABLEGain_balance_expected), 1e12);

      totalUSDSDeposits = await stabilityPool.getTotalUSDSDeposits();
      B_SABLEGain_balance_expected = B_SABLEGain_balance_expected.add(rewardPerSec.mul(B_CompoundedDeposit).div(totalUSDSDeposits));
      C_SABLEGain_balance_expected = C_SABLEGain_balance_expected.add(rewardPerSec.mul(C_CompoundedDeposit).div(totalUSDSDeposits));
      await stabilityPool.withdrawFromSP(dec(10000, 18), DEFAULT_PRICE_FEED_DATA, { from: B })
      assert.isAtMost(getDifference((await sableToken.balanceOf(B)), B_SABLEGain_balance_expected), 1e12);
      
      totalUSDSDeposits = await stabilityPool.getTotalUSDSDeposits();
      C_SABLEGain_balance_expected = C_SABLEGain_balance_expected.add(rewardPerSec.mul(C_CompoundedDeposit).div(totalUSDSDeposits));
      await stabilityPool.withdrawFromSP(dec(10000, 18), DEFAULT_PRICE_FEED_DATA, { from: C })
      assert.isAtMost(getDifference((await sableToken.balanceOf(C)), C_SABLEGain_balance_expected), 1e12);

    })

    // A, B, C deposit. Varied stake. 1 Liquidation. D joins.
    it("withdrawFromSP(): Depositors with varying initial deposit withdraw correct SABLE gain. No liquidations. No front end.", async () => {
      const initialIssuance = await communityIssuanceTester.totalSABLEIssued()
      assert.equal(initialIssuance, 0)

      let rewardPerSec = await communityIssuanceTester.latestRewardPerSec()

      // Whale opens Trove with 10k BNB
      await borrowerOperations.openTrove(th._100pct, dec(10000, 18), whale, whale, DEFAULT_PRICE_FEED_DATA, { from: whale, value: dec(10000, 'ether') })

      await borrowerOperations.openTrove(th._100pct, dec(10000, 18), A, A, DEFAULT_PRICE_FEED_DATA, { from: A, value: dec(200, 'ether') })
      await borrowerOperations.openTrove(th._100pct, dec(20000, 18), B, B, DEFAULT_PRICE_FEED_DATA, { from: B, value: dec(300, 'ether') })
      await borrowerOperations.openTrove(th._100pct, dec(30000, 18), C, C, DEFAULT_PRICE_FEED_DATA, { from: C, value: dec(400, 'ether') })
      await borrowerOperations.openTrove(th._100pct, dec(40000, 18), D, D, DEFAULT_PRICE_FEED_DATA, { from: D, value: dec(500, 'ether') })
      await borrowerOperations.openTrove(th._100pct, dec(40000, 18), E, E, DEFAULT_PRICE_FEED_DATA, { from: E, value: dec(600, 'ether') })

      await borrowerOperations.openTrove(th._100pct, await getOpenTroveUSDSAmount(dec(30000, 18)), defaulter_1, defaulter_1, DEFAULT_PRICE_FEED_DATA, { from: defaulter_1, value: dec(300, 'ether') })

      // Check all SABLE balances are initially 0
      assert.equal(await sableToken.balanceOf(A), 0)
      assert.equal(await sableToken.balanceOf(B), 0)
      assert.equal(await sableToken.balanceOf(C), 0)
      assert.equal(await sableToken.balanceOf(D), 0)

      // A, B, C deposit
      await stabilityPool.provideToSP(dec(10000, 18), ZERO_ADDRESS, { from: A })
      await stabilityPool.provideToSP(dec(20000, 18), ZERO_ADDRESS, { from: B })
      await stabilityPool.provideToSP(dec(30000, 18), ZERO_ADDRESS, { from: C })

      let blockTimestamp_1 = th.toBN(await th.getLatestBlockTimestamp(web3))

      // Minute 1 passes
      await th.fastForwardTime(timeValues.SECONDS_IN_ONE_MINUTE, web3.currentProvider)

      assert.equal(await stabilityPool.getTotalUSDSDeposits(), dec(60000, 18))

      // Price Drops, defaulter1 liquidated. Stability Pool size drops by 50%
      await priceFeed.setPrice(dec(100, 18))
      assert.isFalse(await th.checkRecoveryMode(contracts))
      await troveManager.liquidate(defaulter_1, DEFAULT_PRICE_FEED_DATA)
      assert.isFalse(await sortedTroves.contains(defaulter_1))

      let blockTimestamp_2 = th.toBN(await th.getLatestBlockTimestamp(web3))
      let timestampDiff = blockTimestamp_2.sub(blockTimestamp_1)

      // Confirm SP dropped from 60k to 30k
      assert.isAtMost(getDifference(await stabilityPool.getTotalUSDSDeposits(), dec(30000, 18)), 1000)

      const A_expectedSABLEGain_Y1 = rewardPerSec.add(rewardPerSec.div(toBN(3))).add(rewardPerSec.div(toBN(6)).mul(timestampDiff))
      const B_expectedSABLEGain_Y1 = (rewardPerSec.div(toBN(3)).mul(toBN(2))).add(rewardPerSec.div(toBN(3)).mul(timestampDiff))
      const C_expectedSABLEGain_Y1 = rewardPerSec.div(toBN(2)).mul(timestampDiff)

      // Check SABLE gain
      const A_SABLEGain_Y1 = await stabilityPool.getDepositorSABLEGain(A)
      const B_SABLEGain_Y1 = await stabilityPool.getDepositorSABLEGain(B)
      const C_SABLEGain_Y1 = await stabilityPool.getDepositorSABLEGain(C)

      // Check gains are correct, error tolerance = 1e-6 of a toke
      assert.isAtMost(getDifference(A_SABLEGain_Y1, A_expectedSABLEGain_Y1), 1e12)
      assert.isAtMost(getDifference(B_SABLEGain_Y1, B_expectedSABLEGain_Y1), 1e12)
      assert.isAtMost(getDifference(C_SABLEGain_Y1, C_expectedSABLEGain_Y1), 1e12)

      let totalUSDSDeposits = await stabilityPool.getTotalUSDSDeposits()
      let A_CompoundedDeposit = await stabilityPool.getCompoundedUSDSDeposit(A)
      let B_CompoundedDeposit = await stabilityPool.getCompoundedUSDSDeposit(B)
      let C_CompoundedDeposit = await stabilityPool.getCompoundedUSDSDeposit(C)

      const A_expectedSABLEGain_Y1D = A_SABLEGain_Y1.add(rewardPerSec.mul(A_CompoundedDeposit).div(totalUSDSDeposits))
      const B_expectedSABLEGain_Y1D = B_SABLEGain_Y1.add(rewardPerSec.mul(B_CompoundedDeposit).div(totalUSDSDeposits))
      const C_expectedSABLEGain_Y1D = C_SABLEGain_Y1.add(rewardPerSec.mul(C_CompoundedDeposit).div(totalUSDSDeposits))

      // D deposits 40k
      await stabilityPool.provideToSP(dec(40000, 18), ZERO_ADDRESS, { from: D })

      blockTimestamp_1 = th.toBN(await th.getLatestBlockTimestamp(web3))

      // Minute 2 passes
      await th.fastForwardTime(timeValues.SECONDS_IN_ONE_MINUTE, web3.currentProvider)

      // owner update reward per sec to trigger SABLE gains for A, B, C, D
      await communityIssuanceTester.updateRewardPerSec(dec(1, 18), { from: owner});

      blockTimestamp_2 = th.toBN(await th.getLatestBlockTimestamp(web3))
      timestampDiff = blockTimestamp_2.sub(blockTimestamp_1)

      totalUSDSDeposits = await stabilityPool.getTotalUSDSDeposits()
      A_CompoundedDeposit = await stabilityPool.getCompoundedUSDSDeposit(A)
      B_CompoundedDeposit = await stabilityPool.getCompoundedUSDSDeposit(B)
      C_CompoundedDeposit = await stabilityPool.getCompoundedUSDSDeposit(C)
      let D_CompoundedDeposit = await stabilityPool.getCompoundedUSDSDeposit(D)

      const A_expectedSABLEGain_Y2 = A_expectedSABLEGain_Y1D.add(rewardPerSec.mul(A_CompoundedDeposit).div(totalUSDSDeposits).mul(timestampDiff))
      const B_expectedSABLEGain_Y2 = B_expectedSABLEGain_Y1D.add(rewardPerSec.mul(B_CompoundedDeposit).div(totalUSDSDeposits).mul(timestampDiff))
      const C_expectedSABLEGain_Y2 = C_expectedSABLEGain_Y1D.add(rewardPerSec.mul(C_CompoundedDeposit).div(totalUSDSDeposits).mul(timestampDiff))
      const D_expectedSABLEGain_Y2 = rewardPerSec.mul(D_CompoundedDeposit).div(totalUSDSDeposits).mul(timestampDiff)

      // Check SABLE gain
      const A_SABLEGain_AfterY2 = await stabilityPool.getDepositorSABLEGain(A)
      const B_SABLEGain_AfterY2 = await stabilityPool.getDepositorSABLEGain(B)
      const C_SABLEGain_AfterY2 = await stabilityPool.getDepositorSABLEGain(C)
      const D_SABLEGain_AfterY2 = await stabilityPool.getDepositorSABLEGain(D)

      // Check gains are correct, error tolerance = 1e-6 of a token
      assert.isAtMost(getDifference(A_SABLEGain_AfterY2, A_expectedSABLEGain_Y2), 1e12)
      assert.isAtMost(getDifference(B_SABLEGain_AfterY2, B_expectedSABLEGain_Y2), 1e12)
      assert.isAtMost(getDifference(C_SABLEGain_AfterY2, C_expectedSABLEGain_Y2), 1e12)
      assert.isAtMost(getDifference(D_SABLEGain_AfterY2, D_expectedSABLEGain_Y2), 1e12)

      // Each depositor fully withdraws
      totalUSDSDeposits = await stabilityPool.getTotalUSDSDeposits()
      let A_expectedTotalGain = A_SABLEGain_AfterY2.add(rewardPerSec.mul(A_CompoundedDeposit).div(totalUSDSDeposits))
      let B_expectedTotalGain = B_SABLEGain_AfterY2.add(rewardPerSec.mul(B_CompoundedDeposit).div(totalUSDSDeposits))
      let C_expectedTotalGain = C_SABLEGain_AfterY2.add(rewardPerSec.mul(C_CompoundedDeposit).div(totalUSDSDeposits))
      let D_expectedTotalGain = D_SABLEGain_AfterY2.add(rewardPerSec.mul(D_CompoundedDeposit).div(totalUSDSDeposits))
      await stabilityPool.withdrawFromSP(dec(10000, 18), DEFAULT_PRICE_FEED_DATA, { from: A })
      assert.isAtMost(getDifference((await sableToken.balanceOf(A)), A_expectedTotalGain), 1e12)

      totalUSDSDeposits = await stabilityPool.getTotalUSDSDeposits()
      B_expectedTotalGain = B_expectedTotalGain.add(rewardPerSec.mul(B_CompoundedDeposit).div(totalUSDSDeposits))
      C_expectedTotalGain = C_expectedTotalGain.add(rewardPerSec.mul(C_CompoundedDeposit).div(totalUSDSDeposits))
      D_expectedTotalGain = D_expectedTotalGain.add(rewardPerSec.mul(D_CompoundedDeposit).div(totalUSDSDeposits))
      await stabilityPool.withdrawFromSP(dec(20000, 18), DEFAULT_PRICE_FEED_DATA, { from: B })
      assert.isAtMost(getDifference((await sableToken.balanceOf(B)), B_expectedTotalGain), 1e12)

      totalUSDSDeposits = await stabilityPool.getTotalUSDSDeposits()
      C_expectedTotalGain = C_expectedTotalGain.add(rewardPerSec.mul(C_CompoundedDeposit).div(totalUSDSDeposits))
      D_expectedTotalGain = D_expectedTotalGain.add(rewardPerSec.mul(D_CompoundedDeposit).div(totalUSDSDeposits))
      await stabilityPool.withdrawFromSP(dec(30000, 18), DEFAULT_PRICE_FEED_DATA, { from: C })
      assert.isAtMost(getDifference((await sableToken.balanceOf(C)), C_expectedTotalGain), 1e12)

      totalUSDSDeposits = await stabilityPool.getTotalUSDSDeposits()
      D_expectedTotalGain = D_expectedTotalGain.add(rewardPerSec.mul(D_CompoundedDeposit).div(totalUSDSDeposits))
      await stabilityPool.withdrawFromSP(dec(40000, 18), DEFAULT_PRICE_FEED_DATA, { from: D })
      assert.isAtMost(getDifference((await sableToken.balanceOf(D)), D_expectedTotalGain), 1e12)
    })

    //--- Serial pool-emptying liquidations ---

    /* A, B deposit 100C
    L1 cancels 200C
    B, C deposits 100C
    L2 cancels 200C
    E, F deposit 100C
    L3 cancels 200C
    G,H deposits 100C
    L4 cancels 200C

    Expect all depositors withdraw  1/2 of 1 month's SABLE issuance */
    it('withdrawFromSP(): Depositor withdraws correct SABLE gain after serial pool-emptying liquidations. No front-ends.', async () => {
      const initialIssuance = await communityIssuanceTester.totalSABLEIssued()
      assert.equal(initialIssuance, 0)

      let rewardPerSec = await communityIssuanceTester.latestRewardPerSec()

      // Whale opens Trove with 10k BNB
      await borrowerOperations.openTrove(th._100pct, await getOpenTroveUSDSAmount(dec(10000, 18)), whale, whale, DEFAULT_PRICE_FEED_DATA, { from: whale, value: dec(10000, 'ether') })

      const allDepositors = [A, B, C, D, E, F, G, H]
      // 4 Defaulters open trove with 200USDS debt, and 200% ICR
      await borrowerOperations.openTrove(th._100pct, await getOpenTroveUSDSAmount(dec(20000, 18)), defaulter_1, defaulter_1, DEFAULT_PRICE_FEED_DATA, { from: defaulter_1, value: dec(200, 'ether') })
      await borrowerOperations.openTrove(th._100pct, await getOpenTroveUSDSAmount(dec(20000, 18)), defaulter_2, defaulter_2, DEFAULT_PRICE_FEED_DATA, { from: defaulter_2, value: dec(200, 'ether') })
      await borrowerOperations.openTrove(th._100pct, await getOpenTroveUSDSAmount(dec(20000, 18)), defaulter_3, defaulter_3, DEFAULT_PRICE_FEED_DATA, { from: defaulter_3, value: dec(200, 'ether') })
      await borrowerOperations.openTrove(th._100pct, await getOpenTroveUSDSAmount(dec(20000, 18)), defaulter_4, defaulter_4, DEFAULT_PRICE_FEED_DATA, { from: defaulter_4, value: dec(200, 'ether') })

      // price drops by 50%: defaulter ICR falls to 100%
      await priceFeed.setPrice(dec(100, 18));

      // Check all would-be depositors have 0 SABLE balance
      for (depositor of allDepositors) {
        assert.equal(await sableToken.balanceOf(depositor), '0')
      }

      // A, B each deposit 10k USDS
      await borrowerOperations.openTrove(th._100pct, dec(10000, 18), A, A, DEFAULT_PRICE_FEED_DATA, { from: A, value: dec(200, 'ether') })
      await borrowerOperations.openTrove(th._100pct, dec(10000, 18), B, B, DEFAULT_PRICE_FEED_DATA, { from: B, value: dec(200, 'ether') })

      await stabilityPool.provideToSP(dec(10000, 18), ZERO_ADDRESS, { from: A })
      await stabilityPool.provideToSP(dec(10000, 18), ZERO_ADDRESS, { from: B })

      let blockTimestamp_1 = th.toBN(await th.getLatestBlockTimestamp(web3))

      // 1 month passes
      await th.fastForwardTime(await getDuration(timeValues.SECONDS_IN_ONE_MONTH), web3.currentProvider)

      // Defaulter 1 liquidated. 20k USDS fully offset with pool.
      await troveManager.liquidate(defaulter_1, DEFAULT_PRICE_FEED_DATA, { from: owner });

      let blockTimestamp_2 = th.toBN(await th.getLatestBlockTimestamp(web3))
      let timestampDiff = blockTimestamp_2.sub(blockTimestamp_1)

      let totalUSDSDeposits = await stabilityPool.getTotalUSDSDeposits()
      let A_CompoundedDeposit = await stabilityPool.getCompoundedUSDSDeposit(A)
      let B_CompoundedDeposit = await stabilityPool.getCompoundedUSDSDeposit(B)
      let C_CompoundedDeposit = await stabilityPool.getCompoundedUSDSDeposit(C)
      let D_CompoundedDeposit = await stabilityPool.getCompoundedUSDSDeposit(D)

      let A_expected_accumulated = rewardPerSec.add(rewardPerSec.div(toBN(2)).mul(timestampDiff))
      let B_expected_accumulated = rewardPerSec.div(toBN(2)).mul(timestampDiff)
      let C_expected_accumulated = toBN(0)
      let D_expected_accumulated = toBN(0)
      let E_expected_accumulated = toBN(0)
      let F_expected_accumulated = toBN(0)
      let G_expected_accumulated = toBN(0)
      let H_expected_accumulated = toBN(0)

      // C, D each deposit 10k USDS
      await borrowerOperations.openTrove(th._100pct, dec(10000, 18), C, C, DEFAULT_PRICE_FEED_DATA, { from: C, value: dec(200, 'ether') })
      await borrowerOperations.openTrove(th._100pct, dec(10000, 18), D, D, DEFAULT_PRICE_FEED_DATA, { from: D, value: dec(200, 'ether') })

      await stabilityPool.provideToSP(dec(10000, 18), ZERO_ADDRESS, { from: C })

      totalUSDSDeposits = await stabilityPool.getTotalUSDSDeposits()
      C_CompoundedDeposit = await stabilityPool.getCompoundedUSDSDeposit(C)

      await stabilityPool.provideToSP(dec(10000, 18), ZERO_ADDRESS, { from: D })
      
      C_expected_accumulated = C_expected_accumulated.add(rewardPerSec.mul(C_CompoundedDeposit).div(totalUSDSDeposits))

      blockTimestamp_1 = th.toBN(await th.getLatestBlockTimestamp(web3))

      // 1 month passes
      await th.fastForwardTime(timeValues.SECONDS_IN_ONE_MONTH, web3.currentProvider)

      // Defaulter 2 liquidated. 10k USDS offset
      await troveManager.liquidate(defaulter_2, DEFAULT_PRICE_FEED_DATA, { from: owner });

      blockTimestamp_2 = th.toBN(await th.getLatestBlockTimestamp(web3))
      timestampDiff = blockTimestamp_2.sub(blockTimestamp_1)

      C_expected_accumulated = C_expected_accumulated.add(rewardPerSec.div(toBN(2)).mul(timestampDiff))
      D_expected_accumulated = D_expected_accumulated.add(rewardPerSec.div(toBN(2)).mul(timestampDiff))

      // Erin, Flyn each deposit 100 USDS
      await borrowerOperations.openTrove(th._100pct, dec(10000, 18), E, E, DEFAULT_PRICE_FEED_DATA, { from: E, value: dec(200, 'ether') })
      await borrowerOperations.openTrove(th._100pct, dec(10000, 18), F, F, DEFAULT_PRICE_FEED_DATA, { from: F, value: dec(200, 'ether') })

      await stabilityPool.provideToSP(dec(10000, 18), ZERO_ADDRESS, { from: E })

      totalUSDSDeposits = await stabilityPool.getTotalUSDSDeposits()
      let E_CompoundedDeposit = await stabilityPool.getCompoundedUSDSDeposit(E)

      await stabilityPool.provideToSP(dec(10000, 18), ZERO_ADDRESS, { from: F })

      E_expected_accumulated = E_expected_accumulated.add(rewardPerSec.mul(E_CompoundedDeposit).div(totalUSDSDeposits))

      blockTimestamp_1 = th.toBN(await th.getLatestBlockTimestamp(web3))

      // 1 month passes
      await th.fastForwardTime(timeValues.SECONDS_IN_ONE_MONTH, web3.currentProvider)

      // Defaulter 3 liquidated. 100 USDS offset
      await troveManager.liquidate(defaulter_3, DEFAULT_PRICE_FEED_DATA, { from: owner });

      blockTimestamp_2 = th.toBN(await th.getLatestBlockTimestamp(web3))
      timestampDiff = blockTimestamp_2.sub(blockTimestamp_1)

      E_expected_accumulated = E_expected_accumulated.add(rewardPerSec.div(toBN(2)).mul(timestampDiff))
      F_expected_accumulated = F_expected_accumulated.add(rewardPerSec.div(toBN(2)).mul(timestampDiff))

      // Graham, Harriet each deposit 10k USDS
      await borrowerOperations.openTrove(th._100pct, dec(10000, 18), G, G, DEFAULT_PRICE_FEED_DATA, { from: G, value: dec(200, 'ether') })
      await borrowerOperations.openTrove(th._100pct, dec(10000, 18), H, H, DEFAULT_PRICE_FEED_DATA, { from: H, value: dec(200, 'ether') })

      await stabilityPool.provideToSP(dec(10000, 18), ZERO_ADDRESS, { from: G })

      totalUSDSDeposits = await stabilityPool.getTotalUSDSDeposits()
      let G_CompoundedDeposit = await stabilityPool.getCompoundedUSDSDeposit(G)

      await stabilityPool.provideToSP(dec(10000, 18), ZERO_ADDRESS, { from: H })

      G_expected_accumulated = G_expected_accumulated.add(rewardPerSec.mul(G_CompoundedDeposit).div(totalUSDSDeposits))

      blockTimestamp_1 = th.toBN(await th.getLatestBlockTimestamp(web3))

      // 1 month passes
      await th.fastForwardTime(timeValues.SECONDS_IN_ONE_MONTH, web3.currentProvider)

      // Defaulter 4 liquidated. 100 USDS offset
      await troveManager.liquidate(defaulter_4, DEFAULT_PRICE_FEED_DATA, { from: owner });

      blockTimestamp_2 = th.toBN(await th.getLatestBlockTimestamp(web3))
      timestampDiff = blockTimestamp_2.sub(blockTimestamp_1)

      G_expected_accumulated = G_expected_accumulated.add(rewardPerSec.div(toBN(2)).mul(timestampDiff))
      H_expected_accumulated = H_expected_accumulated.add(rewardPerSec.div(toBN(2)).mul(timestampDiff))

      // All depositors withdraw from SP
      await stabilityPool.withdrawFromSP(dec(10000, 18), DEFAULT_PRICE_FEED_DATA, { from: A })
      await stabilityPool.withdrawFromSP(dec(10000, 18), DEFAULT_PRICE_FEED_DATA, { from: B })
      await stabilityPool.withdrawFromSP(dec(10000, 18), DEFAULT_PRICE_FEED_DATA, { from: C })
      await stabilityPool.withdrawFromSP(dec(10000, 18), DEFAULT_PRICE_FEED_DATA, { from: D })
      await stabilityPool.withdrawFromSP(dec(10000, 18), DEFAULT_PRICE_FEED_DATA, { from: E })
      await stabilityPool.withdrawFromSP(dec(10000, 18), DEFAULT_PRICE_FEED_DATA, { from: F })
      await stabilityPool.withdrawFromSP(dec(10000, 18), DEFAULT_PRICE_FEED_DATA, { from: G })
      await stabilityPool.withdrawFromSP(dec(10000, 18), DEFAULT_PRICE_FEED_DATA, { from: H })

      // Check A, B only earn issuance from month 1. Error tolerance = 1e-3 tokens
      assert.isAtMost(getDifference(await sableToken.balanceOf(A), A_expected_accumulated), 1e15)
      assert.isAtMost(getDifference(await sableToken.balanceOf(B), B_expected_accumulated), 1e15)

      // Check C, D only earn issuance from month 2.  Error tolerance = 1e-3 tokens
      assert.isAtMost(getDifference(await sableToken.balanceOf(C), C_expected_accumulated), 1e15)
      assert.isAtMost(getDifference(await sableToken.balanceOf(D), D_expected_accumulated), 1e15)

      // Check E, F only earn issuance from month 3.  Error tolerance = 1e-3 tokens
      assert.isAtMost(getDifference(await sableToken.balanceOf(E), E_expected_accumulated), 1e15)
      assert.isAtMost(getDifference(await sableToken.balanceOf(F), F_expected_accumulated), 1e15)

      // Check G, H only earn issuance from month 4.  Error tolerance = 1e-3 tokens
      assert.isAtMost(getDifference(await sableToken.balanceOf(G), G_expected_accumulated), 1e15)
      assert.isAtMost(getDifference(await sableToken.balanceOf(H), H_expected_accumulated), 1e15)

      const finalEpoch = (await stabilityPool.currentEpoch()).toString()
      assert.equal(finalEpoch, 4)
    })

    it('SABLE issuance for a given period is not obtainable if the SP was empty during the period', async () => {
      const CIBalanceBefore = await sableToken.balanceOf(communityIssuanceTester.address)

      let rewardPerSec = await communityIssuanceTester.latestRewardPerSec()

      await borrowerOperations.openTrove(th._100pct, dec(16000, 18), A, A, DEFAULT_PRICE_FEED_DATA, { from: A, value: dec(200, 'ether') })
      await borrowerOperations.openTrove(th._100pct, dec(10000, 18), B, B, DEFAULT_PRICE_FEED_DATA, { from: B, value: dec(100, 'ether') })
      await borrowerOperations.openTrove(th._100pct, dec(16000, 18), C, C, DEFAULT_PRICE_FEED_DATA, { from: C, value: dec(200, 'ether') })

      const totalSABLEissuance_0 = await communityIssuanceTester.totalSABLEIssued()
      const G_0 = await stabilityPool.epochToScaleToG(0, 0)  // epochs and scales will not change in this test: no liquidations
      assert.equal(totalSABLEissuance_0, '0')
      assert.equal(G_0, '0')

      let A_expected_accumulated = toBN(0)
      let C_expected_accumulated = toBN(0)

      // 1 month passes (M1)
      await th.fastForwardTime(await getDuration(timeValues.SECONDS_IN_ONE_MONTH), web3.currentProvider)

      // SABLE issuance event triggered: A deposits
      await stabilityPool.provideToSP(dec(10000, 18), ZERO_ADDRESS, { from: A })
      let blockTimestamp_1 = th.toBN(await th.getLatestBlockTimestamp(web3))

      // Check G is not updated, since SP was empty prior to A's deposit
      const G_1 = await stabilityPool.epochToScaleToG(0, 0)
      assert.isTrue(G_1.eq(G_0))

      // Check total SABLE issued is updated
      const totalSABLEissuance_1 = await communityIssuanceTester.totalSABLEIssued()
      assert.isTrue(totalSABLEissuance_1.gt(totalSABLEissuance_0))

      // 1 month passes (M2)
      await th.fastForwardTime(timeValues.SECONDS_IN_ONE_MONTH, web3.currentProvider)

      //SABLE issuance event triggered: A withdraws. 
      await stabilityPool.withdrawFromSP(dec(10000, 18), DEFAULT_PRICE_FEED_DATA, { from: A })

      let blockTimestamp_2 = th.toBN(await th.getLatestBlockTimestamp(web3))
      let timestampDiff = blockTimestamp_2.sub(blockTimestamp_1)

      A_expected_accumulated = A_expected_accumulated.add(rewardPerSec.mul(timestampDiff))

      // Check G is updated, since SP was not empty prior to A's withdrawal
      const G_2 = await stabilityPool.epochToScaleToG(0, 0)
      assert.isTrue(G_2.gt(G_1))

      // Check total SABLE issued is updated
      const totalSABLEissuance_2 = await communityIssuanceTester.totalSABLEIssued()
      assert.isTrue(totalSABLEissuance_2.gt(totalSABLEissuance_1))

      // 1 month passes (M3)
      await th.fastForwardTime(timeValues.SECONDS_IN_ONE_MONTH, web3.currentProvider)

      // SABLE issuance event triggered: C deposits
      await stabilityPool.provideToSP(dec(10000, 18), ZERO_ADDRESS, { from: C })
      blockTimestamp_1 = th.toBN(await th.getLatestBlockTimestamp(web3))

      // Check G is not updated, since SP was empty prior to C's deposit
      const G_3 = await stabilityPool.epochToScaleToG(0, 0)
      assert.isTrue(G_3.eq(G_2))

      // Check total SABLE issued is updated
      const totalSABLEissuance_3 = await communityIssuanceTester.totalSABLEIssued()
      assert.isTrue(totalSABLEissuance_3.gt(totalSABLEissuance_2))

      // 1 month passes (M4)
      await th.fastForwardTime(timeValues.SECONDS_IN_ONE_MONTH, web3.currentProvider)

      // C withdraws
      await stabilityPool.withdrawFromSP(dec(10000, 18), DEFAULT_PRICE_FEED_DATA, { from: C })

      blockTimestamp_2 = th.toBN(await th.getLatestBlockTimestamp(web3))
      timestampDiff = blockTimestamp_2.sub(blockTimestamp_1)

      C_expected_accumulated = C_expected_accumulated.add(rewardPerSec.mul(timestampDiff))

      // Check G is increased, since SP was not empty prior to C's withdrawal
      const G_4 = await stabilityPool.epochToScaleToG(0, 0)
      assert.isTrue(G_4.gt(G_3))

      // Check total SABLE issued is increased
      const totalSABLEissuance_4 = await communityIssuanceTester.totalSABLEIssued()
      assert.isTrue(totalSABLEissuance_4.gt(totalSABLEissuance_3))

      // Get SABLE Gains
      const A_SABLEGain = await sableToken.balanceOf(A)
      const C_SABLEGain = await sableToken.balanceOf(C)

      // Check A earns gains from M2 only
      assert.isAtMost(getDifference(A_SABLEGain, A_expected_accumulated), 1e15)

      // Check C earns gains from M4 only
      assert.isAtMost(getDifference(C_SABLEGain, C_expected_accumulated), 1e15)

      // Check CI has only transferred out tokens for M2 + M4.  1e-3 error tolerance.
      const expectedSABLESentOutFromCI = A_expected_accumulated.add(C_expected_accumulated)
      const CIBalanceAfter = await sableToken.balanceOf(communityIssuanceTester.address)
      const CIBalanceDifference = CIBalanceBefore.sub(CIBalanceAfter)
      assert.isAtMost(getDifference(CIBalanceDifference, expectedSABLESentOutFromCI), 1e15)
    })


    // --- Scale factor changes ---

    /* Serial scale changes

    A make deposit 10k USDS
    1 month passes. L1 decreases P: P = 1e-5 P. L1:   9999.9 USDS, 100 BNB
    B makes deposit 9999.9
    1 month passes. L2 decreases P: P =  1e-5 P. L2:  9999.9 USDS, 100 BNB
    C makes deposit  9999.9
    1 month passes. L3 decreases P: P = 1e-5 P. L3:  9999.9 USDS, 100 BNB
    D makes deposit  9999.9
    1 month passes. L4 decreases P: P = 1e-5 P. L4:  9999.9 USDS, 100 BNB
    E makes deposit  9999.9
    1 month passes. L5 decreases P: P = 1e-5 P. L5:  9999.9 USDS, 100 BNB
    =========
    F makes deposit 100
    1 month passes. L6 empties the Pool. L6:  10000 USDS, 100 BNB

    expect A, B, C, D each withdraw ~1 month's worth of SABLE */
    it("withdrawFromSP(): Several deposits of 100 USDS span one scale factor change. Depositors withdraw correct SABLE gains", async () => {
      let rewardPerSec = await communityIssuanceTester.latestRewardPerSec()
      // Whale opens Trove with 100 BNB
      await borrowerOperations.openTrove(th._100pct, await getOpenTroveUSDSAmount(dec(10000, 18)), whale, whale, DEFAULT_PRICE_FEED_DATA, { from: whale, value: dec(100, 'ether') })

      const fiveDefaulters = [defaulter_1, defaulter_2, defaulter_3, defaulter_4, defaulter_5]

      await borrowerOperations.openTrove(th._100pct, dec(10000, 18), ZERO_ADDRESS, ZERO_ADDRESS, DEFAULT_PRICE_FEED_DATA, { from: A, value: dec(10000, 'ether') })
      await borrowerOperations.openTrove(th._100pct, dec(10000, 18), ZERO_ADDRESS, ZERO_ADDRESS, DEFAULT_PRICE_FEED_DATA, { from: B, value: dec(10000, 'ether') })
      await borrowerOperations.openTrove(th._100pct, dec(10000, 18), ZERO_ADDRESS, ZERO_ADDRESS, DEFAULT_PRICE_FEED_DATA, { from: C, value: dec(10000, 'ether') })
      await borrowerOperations.openTrove(th._100pct, dec(10000, 18), ZERO_ADDRESS, ZERO_ADDRESS, DEFAULT_PRICE_FEED_DATA, { from: D, value: dec(10000, 'ether') })
      await borrowerOperations.openTrove(th._100pct, dec(10000, 18), ZERO_ADDRESS, ZERO_ADDRESS, DEFAULT_PRICE_FEED_DATA, { from: E, value: dec(10000, 'ether') })
      await borrowerOperations.openTrove(th._100pct, dec(10000, 18), ZERO_ADDRESS, ZERO_ADDRESS, DEFAULT_PRICE_FEED_DATA, { from: F, value: dec(10000, 'ether') })

      for (const defaulter of fiveDefaulters) {
        // Defaulters 1-5 each withdraw to 9999.9 debt (including gas comp)
        await borrowerOperations.openTrove(th._100pct, await getOpenTroveUSDSAmount('9999900000000000000000'), defaulter, defaulter, DEFAULT_PRICE_FEED_DATA, { from: defaulter, value: dec(100, 'ether') })
      }

      // Defaulter 6 withdraws to 10k debt (inc. gas comp)
      await borrowerOperations.openTrove(th._100pct, await getOpenTroveUSDSAmount(dec(10000, 18)), defaulter_6, defaulter_6, DEFAULT_PRICE_FEED_DATA, { from: defaulter_6, value: dec(100, 'ether') })

      // Confirm all depositors have 0 SABLE
      for (const depositor of [A, B, C, D, E, F]) {
        assert.equal(await sableToken.balanceOf(depositor), '0')
      }
      // price drops by 50%
      await priceFeed.setPrice(dec(100, 18));

      // Check scale is 0
      // assert.equal(await stabilityPool.currentScale(), '0')

      // A provides to SP
      await stabilityPool.provideToSP(dec(10000, 18), ZERO_ADDRESS, { from: A })

      let blockTimestamp_1 = th.toBN(await th.getLatestBlockTimestamp(web3))

      // 1 month passes
      await th.fastForwardTime(await getDuration(timeValues.SECONDS_IN_ONE_MONTH), web3.currentProvider)

      // Defaulter 1 liquidated.  Value of P updated to  to 1e-5
      const txL1 = await troveManager.liquidate(defaulter_1, DEFAULT_PRICE_FEED_DATA, { from: owner });
      assert.isFalse(await sortedTroves.contains(defaulter_1))
      assert.isTrue(txL1.receipt.status)

      let blockTimestamp_2 = th.toBN(await th.getLatestBlockTimestamp(web3))
      let timestampDiff = blockTimestamp_2.sub(blockTimestamp_1)

      let A_expected_accumulated = rewardPerSec.mul(timestampDiff)
      let totalUSDSDeposits = await stabilityPool.getTotalUSDSDeposits()
      let A_CompoundedDeposit = await stabilityPool.getCompoundedUSDSDeposit(A)

      // Check scale is 0
      assert.equal(await stabilityPool.currentScale(), '0')
      assert.equal(await stabilityPool.P(), dec(1, 13)) //P decreases: P = 1e(18-5) = 1e13

      // B provides to SP
      await stabilityPool.provideToSP(dec(99999, 17), ZERO_ADDRESS, { from: B })

      A_expected_accumulated = A_expected_accumulated.add(rewardPerSec.mul(A_CompoundedDeposit).div(totalUSDSDeposits))

      totalUSDSDeposits = await stabilityPool.getTotalUSDSDeposits()
      A_CompoundedDeposit = await stabilityPool.getCompoundedUSDSDeposit(A)
      let B_CompoundedDeposit = await stabilityPool.getCompoundedUSDSDeposit(B)

      blockTimestamp_1 = th.toBN(await th.getLatestBlockTimestamp(web3))

      // 1 month passes
      await th.fastForwardTime(timeValues.SECONDS_IN_ONE_MONTH, web3.currentProvider)

      // Defaulter 2 liquidated
      const txL2 = await troveManager.liquidate(defaulter_2, DEFAULT_PRICE_FEED_DATA, { from: owner });
      assert.isFalse(await sortedTroves.contains(defaulter_2))
      assert.isTrue(txL2.receipt.status)

      blockTimestamp_2 = th.toBN(await th.getLatestBlockTimestamp(web3))
      timestampDiff = blockTimestamp_2.sub(blockTimestamp_1)

      A_expected_accumulated = A_expected_accumulated.add(rewardPerSec.mul(A_CompoundedDeposit).div(totalUSDSDeposits).mul(timestampDiff))
      let B_expected_accumulated = rewardPerSec.mul(B_CompoundedDeposit).div(totalUSDSDeposits).mul(timestampDiff)

      // Check scale is 1
      assert.equal(await stabilityPool.currentScale(), '1')
      assert.equal(await stabilityPool.P(), dec(1, 17)) //Scale changes and P changes: P = 1e(13-5+9) = 1e17

      // C provides to SP
      await stabilityPool.provideToSP(dec(99999, 17), ZERO_ADDRESS, { from: C })

      A_expected_accumulated = A_expected_accumulated.add(rewardPerSec.mul(A_CompoundedDeposit).div(totalUSDSDeposits))
      B_expected_accumulated = B_expected_accumulated.add(rewardPerSec.mul(B_CompoundedDeposit).div(totalUSDSDeposits))

      totalUSDSDeposits = await stabilityPool.getTotalUSDSDeposits()
      A_CompoundedDeposit = await stabilityPool.getCompoundedUSDSDeposit(A)
      B_CompoundedDeposit = await stabilityPool.getCompoundedUSDSDeposit(B)
      let C_CompoundedDeposit = await stabilityPool.getCompoundedUSDSDeposit(C)

      blockTimestamp_1 = th.toBN(await th.getLatestBlockTimestamp(web3))

      // 1 month passes
      await th.fastForwardTime(timeValues.SECONDS_IN_ONE_MONTH, web3.currentProvider)

      // Defaulter 3 liquidated
      const txL3 = await troveManager.liquidate(defaulter_3, DEFAULT_PRICE_FEED_DATA, { from: owner });
      assert.isFalse(await sortedTroves.contains(defaulter_3))
      assert.isTrue(txL3.receipt.status)

      blockTimestamp_2 = th.toBN(await th.getLatestBlockTimestamp(web3))
      timestampDiff = blockTimestamp_2.sub(blockTimestamp_1)

      A_expected_accumulated = A_expected_accumulated.add(rewardPerSec.mul(A_CompoundedDeposit).div(totalUSDSDeposits).mul(timestampDiff))
      B_expected_accumulated = B_expected_accumulated.add(rewardPerSec.mul(B_CompoundedDeposit).div(totalUSDSDeposits).mul(timestampDiff))
      let C_expected_accumulated = rewardPerSec.mul(C_CompoundedDeposit).div(totalUSDSDeposits).mul(timestampDiff)

      // Check scale is 1
      assert.equal(await stabilityPool.currentScale(), '1')
      assert.equal(await stabilityPool.P(), dec(1, 12)) //P decreases: P 1e(17-5) = 1e12

      // D provides to SP
      await stabilityPool.provideToSP(dec(99999, 17), ZERO_ADDRESS, { from: D })

      A_expected_accumulated = A_expected_accumulated.add(rewardPerSec.mul(A_CompoundedDeposit).div(totalUSDSDeposits))
      B_expected_accumulated = B_expected_accumulated.add(rewardPerSec.mul(B_CompoundedDeposit).div(totalUSDSDeposits))
      C_expected_accumulated = C_expected_accumulated.add(rewardPerSec.mul(C_CompoundedDeposit).div(totalUSDSDeposits))

      totalUSDSDeposits = await stabilityPool.getTotalUSDSDeposits()
      A_CompoundedDeposit = await stabilityPool.getCompoundedUSDSDeposit(A)
      B_CompoundedDeposit = await stabilityPool.getCompoundedUSDSDeposit(B)
      C_CompoundedDeposit = await stabilityPool.getCompoundedUSDSDeposit(C)
      let D_CompoundedDeposit = await stabilityPool.getCompoundedUSDSDeposit(D)

      blockTimestamp_1 = th.toBN(await th.getLatestBlockTimestamp(web3))

      // 1 month passes
      await th.fastForwardTime(timeValues.SECONDS_IN_ONE_MONTH, web3.currentProvider)

      // Defaulter 4 liquidated
      const txL4 = await troveManager.liquidate(defaulter_4, DEFAULT_PRICE_FEED_DATA, { from: owner });
      assert.isFalse(await sortedTroves.contains(defaulter_4))
      assert.isTrue(txL4.receipt.status)

      blockTimestamp_2 = th.toBN(await th.getLatestBlockTimestamp(web3))
      timestampDiff = blockTimestamp_2.sub(blockTimestamp_1)

      A_expected_accumulated = A_expected_accumulated.add(rewardPerSec.mul(A_CompoundedDeposit).div(totalUSDSDeposits).mul(timestampDiff))
      B_expected_accumulated = B_expected_accumulated.add(rewardPerSec.mul(B_CompoundedDeposit).div(totalUSDSDeposits).mul(timestampDiff))
      C_expected_accumulated = C_expected_accumulated.add(rewardPerSec.mul(C_CompoundedDeposit).div(totalUSDSDeposits).mul(timestampDiff))
      let D_expected_accumulated = rewardPerSec.mul(D_CompoundedDeposit).div(totalUSDSDeposits).mul(timestampDiff)

      // Check scale is 2
      assert.equal(await stabilityPool.currentScale(), '2')
      assert.equal(await stabilityPool.P(), dec(1, 16)) //Scale changes and P changes:: P = 1e(12-5+9) = 1e16

      // E provides to SP
      await stabilityPool.provideToSP(dec(99999, 17), ZERO_ADDRESS, { from: E })

      A_expected_accumulated = A_expected_accumulated.add(rewardPerSec.mul(A_CompoundedDeposit).div(totalUSDSDeposits))
      B_expected_accumulated = B_expected_accumulated.add(rewardPerSec.mul(B_CompoundedDeposit).div(totalUSDSDeposits))
      C_expected_accumulated = C_expected_accumulated.add(rewardPerSec.mul(C_CompoundedDeposit).div(totalUSDSDeposits))
      D_expected_accumulated = D_expected_accumulated.add(rewardPerSec.mul(D_CompoundedDeposit).div(totalUSDSDeposits))

      totalUSDSDeposits = await stabilityPool.getTotalUSDSDeposits()
      A_CompoundedDeposit = await stabilityPool.getCompoundedUSDSDeposit(A)
      B_CompoundedDeposit = await stabilityPool.getCompoundedUSDSDeposit(B)
      C_CompoundedDeposit = await stabilityPool.getCompoundedUSDSDeposit(C)
      D_CompoundedDeposit = await stabilityPool.getCompoundedUSDSDeposit(D)
      let E_CompoundedDeposit = await stabilityPool.getCompoundedUSDSDeposit(E)

      blockTimestamp_1 = th.toBN(await th.getLatestBlockTimestamp(web3))

      // 1 month passes
      await th.fastForwardTime(timeValues.SECONDS_IN_ONE_MONTH, web3.currentProvider)

      // Defaulter 5 liquidated
      const txL5 = await troveManager.liquidate(defaulter_5, DEFAULT_PRICE_FEED_DATA, { from: owner });
      assert.isFalse(await sortedTroves.contains(defaulter_5))
      assert.isTrue(txL5.receipt.status)

      blockTimestamp_2 = th.toBN(await th.getLatestBlockTimestamp(web3))
      timestampDiff = blockTimestamp_2.sub(blockTimestamp_1)

      A_expected_accumulated = A_expected_accumulated.add(rewardPerSec.mul(A_CompoundedDeposit).div(totalUSDSDeposits).mul(timestampDiff))
      B_expected_accumulated = B_expected_accumulated.add(rewardPerSec.mul(B_CompoundedDeposit).div(totalUSDSDeposits).mul(timestampDiff))
      C_expected_accumulated = C_expected_accumulated.add(rewardPerSec.mul(C_CompoundedDeposit).div(totalUSDSDeposits).mul(timestampDiff))
      D_expected_accumulated = D_expected_accumulated.add(rewardPerSec.mul(D_CompoundedDeposit).div(totalUSDSDeposits).mul(timestampDiff))
      let E_expected_accumulated = rewardPerSec.mul(E_CompoundedDeposit).div(totalUSDSDeposits).mul(timestampDiff)

      // Check scale is 2
      assert.equal(await stabilityPool.currentScale(), '2')
      assert.equal(await stabilityPool.P(), dec(1, 11)) // P decreases: P = 1e(16-5) = 1e11

      // F provides to SP
      await stabilityPool.provideToSP(dec(99999, 17), ZERO_ADDRESS, { from: F })

      A_expected_accumulated = A_expected_accumulated.add(rewardPerSec.mul(A_CompoundedDeposit).div(totalUSDSDeposits))
      B_expected_accumulated = B_expected_accumulated.add(rewardPerSec.mul(B_CompoundedDeposit).div(totalUSDSDeposits))
      C_expected_accumulated = C_expected_accumulated.add(rewardPerSec.mul(C_CompoundedDeposit).div(totalUSDSDeposits))
      D_expected_accumulated = D_expected_accumulated.add(rewardPerSec.mul(D_CompoundedDeposit).div(totalUSDSDeposits))
      E_expected_accumulated = E_expected_accumulated.add(rewardPerSec.mul(E_CompoundedDeposit).div(totalUSDSDeposits))

      totalUSDSDeposits = await stabilityPool.getTotalUSDSDeposits()
      A_CompoundedDeposit = await stabilityPool.getCompoundedUSDSDeposit(A)
      B_CompoundedDeposit = await stabilityPool.getCompoundedUSDSDeposit(B)
      C_CompoundedDeposit = await stabilityPool.getCompoundedUSDSDeposit(C)
      D_CompoundedDeposit = await stabilityPool.getCompoundedUSDSDeposit(D)
      E_CompoundedDeposit = await stabilityPool.getCompoundedUSDSDeposit(E)
      let F_CompoundedDeposit = await stabilityPool.getCompoundedUSDSDeposit(F)

      blockTimestamp_1 = th.toBN(await th.getLatestBlockTimestamp(web3))

      // 1 month passes
      await th.fastForwardTime(timeValues.SECONDS_IN_ONE_MONTH, web3.currentProvider)

      assert.equal(await stabilityPool.currentEpoch(), '0')

      // Defaulter 6 liquidated
      const txL6 = await troveManager.liquidate(defaulter_6, DEFAULT_PRICE_FEED_DATA, { from: owner });
      assert.isFalse(await sortedTroves.contains(defaulter_6))
      assert.isTrue(txL6.receipt.status)

      blockTimestamp_2 = th.toBN(await th.getLatestBlockTimestamp(web3))
      timestampDiff = blockTimestamp_2.sub(blockTimestamp_1)

      A_expected_accumulated = A_expected_accumulated.add(rewardPerSec.mul(A_CompoundedDeposit).div(totalUSDSDeposits).mul(timestampDiff))
      B_expected_accumulated = B_expected_accumulated.add(rewardPerSec.mul(B_CompoundedDeposit).div(totalUSDSDeposits).mul(timestampDiff))
      C_expected_accumulated = C_expected_accumulated.add(rewardPerSec.mul(C_CompoundedDeposit).div(totalUSDSDeposits).mul(timestampDiff))
      D_expected_accumulated = D_expected_accumulated.add(rewardPerSec.mul(D_CompoundedDeposit).div(totalUSDSDeposits).mul(timestampDiff))
      E_expected_accumulated = E_expected_accumulated.add(rewardPerSec.mul(E_CompoundedDeposit).div(totalUSDSDeposits).mul(timestampDiff))
      let F_expected_accumulated = rewardPerSec.mul(F_CompoundedDeposit).div(totalUSDSDeposits).mul(timestampDiff)

      // Check scale is 0, epoch is 1
      assert.equal(await stabilityPool.currentScale(), '0')
      assert.equal(await stabilityPool.currentEpoch(), '1')
      assert.equal(await stabilityPool.P(), dec(1, 18)) // P resets to 1e18 after pool-emptying

      // price doubles
      await priceFeed.setPrice(dec(200, 18));

      /* All depositors withdraw fully from SP.  Withdraw in reverse order, so that the largest remaining
      deposit (F) withdraws first, and does not get extra SABLE gains from the periods between withdrawals */
      for (depositor of [F, E, D, C, B, A]) {
        await stabilityPool.withdrawFromSP(dec(10000, 18), DEFAULT_PRICE_FEED_DATA, { from: depositor })
      }

      const SABLEGain_A = await sableToken.balanceOf(A)
      const SABLEGain_B = await sableToken.balanceOf(B)
      const SABLEGain_C = await sableToken.balanceOf(C)
      const SABLEGain_D = await sableToken.balanceOf(D)
      const SABLEGain_E = await sableToken.balanceOf(E)
      const SABLEGain_F = await sableToken.balanceOf(F)

      assert.isAtMost(getDifference(A_expected_accumulated, SABLEGain_A), 1e15)
      assert.isAtMost(getDifference(B_expected_accumulated, SABLEGain_B), 1e15)
      assert.isAtMost(getDifference(C_expected_accumulated, SABLEGain_C), 1e15)
      assert.isAtMost(getDifference(D_expected_accumulated, SABLEGain_D), 1e15)
      assert.isAtMost(getDifference(E_expected_accumulated, SABLEGain_E), 1e15)
      assert.isAtMost(getDifference(F_expected_accumulated, SABLEGain_F), 1e15)
    })

    // --- FrontEnds and kickback rates

    // Simple case: 4 depositors, equal stake. No liquidations.
    it("withdrawFromSP(): Depositors with equal initial deposit withdraw correct SABLE gain. No liquidations. Front ends and kickback rates.", async () => {
      // Register 2 front ends
      const kickbackRate_F1 = toBN(dec(5, 17)) // F1 kicks 50% back to depositor
      const kickbackRate_F2 = toBN(dec(80, 16)) // F2 kicks 80% back to depositor

      let rewardPerSec = await communityIssuanceTester.latestRewardPerSec();

      await stabilityPool.registerFrontEnd(kickbackRate_F1, { from: frontEnd_1 })
      await stabilityPool.registerFrontEnd(kickbackRate_F2, { from: frontEnd_2 })

      const initialIssuance = await communityIssuanceTester.totalSABLEIssued()
      assert.equal(initialIssuance, 0)

      // Whale opens Trove with 10k BNB
      await borrowerOperations.openTrove(th._100pct, dec(10000, 18), whale, whale, DEFAULT_PRICE_FEED_DATA, { from: whale, value: dec(10000, 'ether') })

      await borrowerOperations.openTrove(th._100pct, dec(10000, 18), A, A, DEFAULT_PRICE_FEED_DATA, { from: A, value: dec(100, 'ether') })
      await borrowerOperations.openTrove(th._100pct, dec(10000, 18), B, B, DEFAULT_PRICE_FEED_DATA, { from: B, value: dec(100, 'ether') })
      await borrowerOperations.openTrove(th._100pct, dec(10000, 18), C, C, DEFAULT_PRICE_FEED_DATA, { from: C, value: dec(100, 'ether') })
      await borrowerOperations.openTrove(th._100pct, dec(10000, 18), D, D, DEFAULT_PRICE_FEED_DATA, { from: D, value: dec(100, 'ether') })
      await borrowerOperations.openTrove(th._100pct, dec(10000, 18), E, E, DEFAULT_PRICE_FEED_DATA, { from: E, value: dec(100, 'ether') })

      // Check all SABLE balances are initially 0
      assert.equal(await sableToken.balanceOf(A), 0)
      assert.equal(await sableToken.balanceOf(B), 0)
      assert.equal(await sableToken.balanceOf(C), 0)
      assert.equal(await sableToken.balanceOf(D), 0)
      assert.equal(await sableToken.balanceOf(frontEnd_1), 0)
      assert.equal(await sableToken.balanceOf(frontEnd_2), 0)

      // A, B, C, D deposit
      await stabilityPool.provideToSP(dec(10000, 18), frontEnd_1, { from: A })
      await stabilityPool.provideToSP(dec(10000, 18), frontEnd_2, { from: B })
      await stabilityPool.provideToSP(dec(10000, 18), frontEnd_2, { from: C })
      await stabilityPool.provideToSP(dec(10000, 18), ZERO_ADDRESS, { from: D })

      // Check initial frontEnd stakes are correct:
      F1_stake = await stabilityPool.frontEndStakes(frontEnd_1)
      F2_stake = await stabilityPool.frontEndStakes(frontEnd_2)

      assert.equal(F1_stake, dec(10000, 18))
      assert.equal(F2_stake, dec(20000, 18))

      let blockTimestamp_1 = th.toBN(await th.getLatestBlockTimestamp(web3)) 

      // One minute passes
      await th.fastForwardTime(timeValues.SECONDS_IN_ONE_MINUTE, web3.currentProvider)

      // owner update reward per sec to trigger SABLE gains for A, B, C.
      await communityIssuanceTester.updateRewardPerSec(dec(1, 18), { from: owner});

      let blockTimestamp_2 = th.toBN(await th.getLatestBlockTimestamp(web3)) 
      let timestampDiff = blockTimestamp_2.sub(blockTimestamp_1)

      const A_expected_Y1 = rewardPerSec.add(rewardPerSec.div(toBN(2))).add(rewardPerSec.div(toBN(3))).add(rewardPerSec.div(toBN(4)).mul(timestampDiff))
      const B_expected_Y1 = (rewardPerSec.div(toBN(2))).add(rewardPerSec.div(toBN(3))).add(rewardPerSec.div(toBN(4)).mul(timestampDiff))
      const C_expected_Y1 = (rewardPerSec.div(toBN(3))).add(rewardPerSec.div(toBN(4)).mul(timestampDiff))
      const D_expected_Y1 = rewardPerSec.div(toBN(4)).mul(timestampDiff)
      
      // Get actual SABLE gains
      const A_SABLEGain_Y1 = await stabilityPool.getDepositorSABLEGain(A)
      const B_SABLEGain_Y1 = await stabilityPool.getDepositorSABLEGain(B)
      const C_SABLEGain_Y1 = await stabilityPool.getDepositorSABLEGain(C)
      const D_SABLEGain_Y1 = await stabilityPool.getDepositorSABLEGain(D)
      const F1_SABLEGain_Y1 = await stabilityPool.getFrontEndSABLEGain(frontEnd_1)
      const F2_SABLEGain_Y1 = await stabilityPool.getFrontEndSABLEGain(frontEnd_2)

      // Expected depositor and front-end gains
      let A_expectedGain_Y1 = kickbackRate_F1.mul(A_expected_Y1).div(toBN(dec(1, 18)))
      let B_expectedGain_Y1 = kickbackRate_F2.mul(B_expected_Y1).div(toBN(dec(1, 18)))
      let C_expectedGain_Y1 = kickbackRate_F2.mul(C_expected_Y1).div(toBN(dec(1, 18)))
      let D_expectedGain_Y1 = D_expected_Y1

      let F1_expectedGain_Y1 = toBN(dec(1, 18)).sub(kickbackRate_F1)
        .mul(A_expected_Y1)
        .div(toBN(dec(1, 18)))

      // C provideSP -> frontend_2 receive some sable
      let F2_expectedGain_Y1 = toBN(dec(1, 18)).sub(kickbackRate_F2)
        .mul(B_expected_Y1.add(C_expected_Y1))
        .div(toBN(dec(1, 18))).sub(await sableToken.balanceOf(frontEnd_2))

      // Check gains are correct, error tolerance = 1e-6 of a token
      assert.isAtMost(getDifference(A_SABLEGain_Y1, A_expectedGain_Y1), 1e12)
      assert.isAtMost(getDifference(B_SABLEGain_Y1, B_expectedGain_Y1), 1e12)
      assert.isAtMost(getDifference(C_SABLEGain_Y1, C_expectedGain_Y1), 1e12)
      assert.isAtMost(getDifference(D_SABLEGain_Y1, D_expectedGain_Y1), 1e12)

      assert.isAtMost(getDifference(F1_SABLEGain_Y1, F1_expectedGain_Y1), 1e12)
      assert.isAtMost(getDifference(F2_SABLEGain_Y1, F2_expectedGain_Y1), 1e12)

      blockTimestamp_1 = th.toBN(await th.getLatestBlockTimestamp(web3))

      // Another minute passes
      await th.fastForwardTime(timeValues.SECONDS_IN_ONE_MINUTE, web3.currentProvider)

      // owner update reward per sec to trigger SABLE gains for A, B, C.
      await communityIssuanceTester.updateRewardPerSec(dec(1, 18), { from: owner});

      blockTimestamp_2 = th.toBN(await th.getLatestBlockTimestamp(web3)) 
      timestampDiff = blockTimestamp_2.sub(blockTimestamp_1)

      let A_expectedGain_Y2 = A_expected_Y1.add(rewardPerSec.div(toBN(4)).mul(timestampDiff))
      let B_expectedGain_Y2 = B_expected_Y1.add(rewardPerSec.div(toBN(4)).mul(timestampDiff))
      let C_expectedGain_Y2 = C_expected_Y1.add(rewardPerSec.div(toBN(4)).mul(timestampDiff))
      let D_expectedGain_Y2 = D_expected_Y1.add(rewardPerSec.div(toBN(4)).mul(timestampDiff))

      // Each depositor fully withdraws
      let totalUSDSDeposits = await stabilityPool.getTotalUSDSDeposits();
      const A_CompoundedDeposit = await stabilityPool.getCompoundedUSDSDeposit(A);
      const B_CompoundedDeposit = await stabilityPool.getCompoundedUSDSDeposit(B);
      const C_CompoundedDeposit = await stabilityPool.getCompoundedUSDSDeposit(C);
      const D_CompoundedDeposit = await stabilityPool.getCompoundedUSDSDeposit(D);
      let AFinalIssuance = A_expectedGain_Y2.add(rewardPerSec.mul(A_CompoundedDeposit).div(totalUSDSDeposits))
      let BFinalIssuance = B_expectedGain_Y2.add(rewardPerSec.mul(B_CompoundedDeposit).div(totalUSDSDeposits))
      let CFinalIssuance = C_expectedGain_Y2.add(rewardPerSec.mul(C_CompoundedDeposit).div(totalUSDSDeposits))
      let DFinalIssuance = D_expectedGain_Y2.add(rewardPerSec.mul(D_CompoundedDeposit).div(totalUSDSDeposits))
      const A_expectedFinalGain = kickbackRate_F1.mul(AFinalIssuance).div(toBN(dec(1, 18)))
      await stabilityPool.withdrawFromSP(dec(10000, 18), DEFAULT_PRICE_FEED_DATA, { from: A })
      assert.isAtMost(getDifference((await sableToken.balanceOf(A)), A_expectedFinalGain), 1e12)
      
      totalUSDSDeposits = await stabilityPool.getTotalUSDSDeposits();
      BFinalIssuance = BFinalIssuance.add(rewardPerSec.mul(B_CompoundedDeposit).div(totalUSDSDeposits))
      CFinalIssuance = CFinalIssuance.add(rewardPerSec.mul(C_CompoundedDeposit).div(totalUSDSDeposits))
      DFinalIssuance = DFinalIssuance.add(rewardPerSec.mul(D_CompoundedDeposit).div(totalUSDSDeposits))
      const B_expectedFinalGain = kickbackRate_F2.mul(BFinalIssuance).div(toBN(dec(1, 18)))
      await stabilityPool.withdrawFromSP(dec(10000, 18), DEFAULT_PRICE_FEED_DATA, { from: B })
      assert.isAtMost(getDifference((await sableToken.balanceOf(B)), B_expectedFinalGain), 1e12)

      totalUSDSDeposits = await stabilityPool.getTotalUSDSDeposits();
      CFinalIssuance = CFinalIssuance.add(rewardPerSec.mul(C_CompoundedDeposit).div(totalUSDSDeposits))
      DFinalIssuance = DFinalIssuance.add(rewardPerSec.mul(D_CompoundedDeposit).div(totalUSDSDeposits))
      const C_expectedFinalGain = kickbackRate_F2.mul(CFinalIssuance).div(toBN(dec(1, 18)))
      await stabilityPool.withdrawFromSP(dec(10000, 18), DEFAULT_PRICE_FEED_DATA, { from: C })
      assert.isAtMost(getDifference((await sableToken.balanceOf(C)), C_expectedFinalGain), 1e12)

      totalUSDSDeposits = await stabilityPool.getTotalUSDSDeposits();
      DFinalIssuance = DFinalIssuance.add(rewardPerSec.mul(D_CompoundedDeposit).div(totalUSDSDeposits))
      const D_expectedFinalGain = DFinalIssuance
      await stabilityPool.withdrawFromSP(dec(10000, 18), DEFAULT_PRICE_FEED_DATA, { from: D })
      assert.isAtMost(getDifference((await sableToken.balanceOf(D)), D_expectedFinalGain), 1e12)

      const F1_expectedFinalGain = th.toBN(dec(1, 18)).sub(kickbackRate_F1)
        .mul(AFinalIssuance)
        .div(toBN(dec(1, 18)))

      const F2_expectedFinalGain = th.toBN(dec(1, 18)).sub(kickbackRate_F2)
        .mul(BFinalIssuance.add(CFinalIssuance))
        .div(toBN(dec(1, 18)))

      assert.isAtMost(getDifference((await sableToken.balanceOf(frontEnd_1)), F1_expectedFinalGain), 1e12)
      assert.isAtMost(getDifference((await sableToken.balanceOf(frontEnd_2)), F2_expectedFinalGain), 1e12)
    })

    // A, B, C, D deposit 10k,20k,30k,40k.
    // F1: A
    // F2: B, C
    // D makes a naked deposit (no front end)
    // Pool size: 100k
    // 1 month passes. 1st liquidation: 500. All deposits reduced by 500/1000 = 50%.  A:5000,   B:10000, C:15000,   D:20000
    // Pool size: 50k
    // E deposits 30k via F1                                                          A:5000,   B:10000, C:15000,   D:20000, E:30000
    // Pool size: 80k
    // 1 month passes. 2nd liquidation: 20k. All deposits reduced by 200/800 = 25%    A:3750, B:7500,  C:11250, D:15000, E:22500
    // Pool size: 60k
    // B tops up 40k                                                                  A:3750, B:47500, C:11250, D:1500, E:22500
    // Pool size: 100k
    // 1 month passes. 3rd liquidation: 10k. All deposits reduced by 10%.             A:3375, B:42750, C:10125, D:13500, E:20250
    // Pool size 90k
    // C withdraws 10k                                                                A:3375, B:42750, C:125, D:13500, E:20250
    // Pool size 80k
    // 1 month passes.
    // All withdraw
    it("withdrawFromSP(): Depositors with varying initial deposit withdraw correct SABLE gain. Front ends and kickback rates", async () => {
      // Register 2 front ends
      const F1_kickbackRate = toBN(dec(5, 17)) // F1 kicks 50% back to depositor
      const F2_kickbackRate = toBN(dec(80, 16)) // F2 kicks 80% back to depositor

      let rewardPerSec = await communityIssuanceTester.latestRewardPerSec();

      await stabilityPool.registerFrontEnd(F1_kickbackRate, { from: frontEnd_1 })
      await stabilityPool.registerFrontEnd(F2_kickbackRate, { from: frontEnd_2 })

      const initialIssuance = await communityIssuanceTester.totalSABLEIssued()
      assert.equal(initialIssuance, 0)

      // Whale opens Trove with 10k BNB
      await borrowerOperations.openTrove(th._100pct, dec(10000, 18), whale, whale, DEFAULT_PRICE_FEED_DATA, { from: whale, value: dec(10000, 'ether') })

      await borrowerOperations.openTrove(th._100pct, dec(10000, 18), A, A, DEFAULT_PRICE_FEED_DATA, { from: A, value: dec(200, 'ether') })
      await borrowerOperations.openTrove(th._100pct, dec(60000, 18), B, B, DEFAULT_PRICE_FEED_DATA, { from: B, value: dec(800, 'ether') })
      await borrowerOperations.openTrove(th._100pct, dec(30000, 18), C, C, DEFAULT_PRICE_FEED_DATA, { from: C, value: dec(400, 'ether') })
      await borrowerOperations.openTrove(th._100pct, dec(40000, 18), D, D, DEFAULT_PRICE_FEED_DATA, { from: D, value: dec(500, 'ether') })

      await borrowerOperations.openTrove(th._100pct, dec(30000, 18), E, E, DEFAULT_PRICE_FEED_DATA, { from: E, value: dec(400, 'ether') })

      // D1, D2, D3 open troves with total debt 50k, 30k, 10k respectively (inc. gas comp)
      await borrowerOperations.openTrove(th._100pct, await getOpenTroveUSDSAmount(dec(50000, 18)), defaulter_1, defaulter_1, DEFAULT_PRICE_FEED_DATA, { from: defaulter_1, value: dec(500, 'ether') })
      await borrowerOperations.openTrove(th._100pct, await getOpenTroveUSDSAmount(dec(20000, 18)), defaulter_2, defaulter_2, DEFAULT_PRICE_FEED_DATA, { from: defaulter_2, value: dec(200, 'ether') })
      await borrowerOperations.openTrove(th._100pct, await getOpenTroveUSDSAmount(dec(10000, 18)), defaulter_3, defaulter_3, DEFAULT_PRICE_FEED_DATA, { from: defaulter_3, value: dec(100, 'ether') })

      // Check all SABLE balances are initially 0
      assert.equal(await sableToken.balanceOf(A), 0)
      assert.equal(await sableToken.balanceOf(B), 0)
      assert.equal(await sableToken.balanceOf(C), 0)
      assert.equal(await sableToken.balanceOf(D), 0)
      assert.equal(await sableToken.balanceOf(frontEnd_1), 0)
      assert.equal(await sableToken.balanceOf(frontEnd_2), 0)

      // A, B, C, D deposit
      await stabilityPool.provideToSP(dec(10000, 18), frontEnd_1, { from: A })
      await stabilityPool.provideToSP(dec(20000, 18), frontEnd_2, { from: B })
      await stabilityPool.provideToSP(dec(30000, 18), frontEnd_2, { from: C })
      await stabilityPool.provideToSP(dec(40000, 18), ZERO_ADDRESS, { from: D })

      let blockTimestamp_1 = th.toBN(await th.getLatestBlockTimestamp(web3))

      // Price Drops, defaulters become undercollateralized
      await priceFeed.setPrice(dec(105, 18))
      assert.isFalse(await th.checkRecoveryMode(contracts))

      // Check initial frontEnd stakes are correct:
      F1_stake = await stabilityPool.frontEndStakes(frontEnd_1)
      F2_stake = await stabilityPool.frontEndStakes(frontEnd_2)

      assert.equal(F1_stake, dec(10000, 18))
      assert.equal(F2_stake, dec(50000, 18))

      // Month 1 passes
      await th.fastForwardTime(await getDuration(timeValues.SECONDS_IN_ONE_MONTH), web3.currentProvider)

      assert.equal(await stabilityPool.getTotalUSDSDeposits(), dec(100000, 18)) // total 100k

      // LIQUIDATION 1
      await troveManager.liquidate(defaulter_1, DEFAULT_PRICE_FEED_DATA)
      assert.isFalse(await sortedTroves.contains(defaulter_1))

      let blockTimestamp_2 = th.toBN(await th.getLatestBlockTimestamp(web3)) 
      let timestampDiff = blockTimestamp_2.sub(blockTimestamp_1)

      th.assertIsApproximatelyEqual(await stabilityPool.getTotalUSDSDeposits(), dec(50000, 18))  // 50k

      // --- CHECK GAINS AFTER L1 ---

      // During month 1, deposit sizes are: A:10000, B:20000, C:30000, D:40000.  Total: 100000
      // Expected gains for each depositor after month 1 
      const A_share_M1 = rewardPerSec.add(rewardPerSec.div(toBN(3))).add(rewardPerSec.div(toBN(6))).add(rewardPerSec.div(toBN(10)).mul(timestampDiff))
      const A_expectedSABLEGain_M1 = F1_kickbackRate.mul(A_share_M1).div(toBN(dec(1, 18)))

      const B_share_M1 = (rewardPerSec.mul(toBN(2)).div(toBN(3))).add(rewardPerSec.div(toBN(3))).add(rewardPerSec.div(toBN(5)).mul(timestampDiff))
      const B_expectedSABLEGain_M1 = F2_kickbackRate.mul(B_share_M1).div(toBN(dec(1, 18)))

      const C_share_M1 = (rewardPerSec.div(toBN(2))).add(rewardPerSec.mul(toBN(3)).div(toBN(10)).mul(timestampDiff))
      const C_expectedSABLEGain_M1 = F2_kickbackRate.mul(C_share_M1).div(toBN(dec(1, 18)))

      const D_share_M1 = rewardPerSec.mul(toBN(2)).div(toBN(5)).mul(timestampDiff)
      const D_expectedSABLEGain_M1 = D_share_M1

      let A_expected_accumulated = A_share_M1;
      let B_expected_accumulated = B_share_M1;
      let C_expected_accumulated = C_share_M1;
      let D_expected_accumulated = D_share_M1;

      let totalUSDSDeposits = await stabilityPool.getTotalUSDSDeposits();
      let A_CompoundedDeposit = await stabilityPool.getCompoundedUSDSDeposit(A);
      let B_CompoundedDeposit = await stabilityPool.getCompoundedUSDSDeposit(B);
      let C_CompoundedDeposit = await stabilityPool.getCompoundedUSDSDeposit(C);
      let D_CompoundedDeposit = await stabilityPool.getCompoundedUSDSDeposit(D);

      // F1's stake = A 
      const F1_expectedSABLEGain_M1 = toBN(dec(1, 18))
        .sub(F1_kickbackRate)
        .mul(A_expected_accumulated)
        .div(toBN(dec(1, 18)))

      // F2's stake = B + C
      const F2_expectedSABLEGain_M1 = toBN(dec(1, 18))
        .sub(F2_kickbackRate)
        .mul(B_expected_accumulated.add(C_expected_accumulated))
        .div(toBN(dec(1, 18))).sub(await sableToken.balanceOf(frontEnd_2))

      // Check SABLE gain
      const A_SABLEGain_M1 = await stabilityPool.getDepositorSABLEGain(A)
      const B_SABLEGain_M1 = await stabilityPool.getDepositorSABLEGain(B)
      const C_SABLEGain_M1 = await stabilityPool.getDepositorSABLEGain(C)
      const D_SABLEGain_M1 = await stabilityPool.getDepositorSABLEGain(D)
      const F1_SABLEGain_M1 = await stabilityPool.getFrontEndSABLEGain(frontEnd_1)
      const F2_SABLEGain_M1 = await stabilityPool.getFrontEndSABLEGain(frontEnd_2)

      // Check gains are correct, error tolerance = 1e-3 of a token
      assert.isAtMost(getDifference(A_SABLEGain_M1, A_expectedSABLEGain_M1), 1e15)
      assert.isAtMost(getDifference(B_SABLEGain_M1, B_expectedSABLEGain_M1), 1e15)
      assert.isAtMost(getDifference(C_SABLEGain_M1, C_expectedSABLEGain_M1), 1e15)
      assert.isAtMost(getDifference(D_SABLEGain_M1, D_expectedSABLEGain_M1), 1e15)
      assert.isAtMost(getDifference(F1_SABLEGain_M1, F1_expectedSABLEGain_M1), 1e15)
      assert.isAtMost(getDifference(F2_SABLEGain_M1, F2_expectedSABLEGain_M1), 1e15)

      // E deposits 30k via F1
      await stabilityPool.provideToSP(dec(30000, 18), frontEnd_1, { from: E })

      A_expected_accumulated = A_expected_accumulated.add(rewardPerSec.mul(A_CompoundedDeposit).div(totalUSDSDeposits));
      B_expected_accumulated = B_expected_accumulated.add(rewardPerSec.mul(B_CompoundedDeposit).div(totalUSDSDeposits));
      C_expected_accumulated = C_expected_accumulated.add(rewardPerSec.mul(C_CompoundedDeposit).div(totalUSDSDeposits));
      D_expected_accumulated = D_expected_accumulated.add(rewardPerSec.mul(D_CompoundedDeposit).div(totalUSDSDeposits));
      let E_expected_accumulated = toBN(0)

      totalUSDSDeposits = await stabilityPool.getTotalUSDSDeposits();
      A_CompoundedDeposit = await stabilityPool.getCompoundedUSDSDeposit(A);
      B_CompoundedDeposit = await stabilityPool.getCompoundedUSDSDeposit(B);
      C_CompoundedDeposit = await stabilityPool.getCompoundedUSDSDeposit(C);
      D_CompoundedDeposit = await stabilityPool.getCompoundedUSDSDeposit(D);
      let E_CompoundedDeposit = await stabilityPool.getCompoundedUSDSDeposit(E);

      blockTimestamp_1 = th.toBN(await th.getLatestBlockTimestamp(web3))

      th.assertIsApproximatelyEqual(await stabilityPool.getTotalUSDSDeposits(), dec(80000, 18))

      // Month 2 passes
      await th.fastForwardTime(timeValues.SECONDS_IN_ONE_MONTH, web3.currentProvider)

      // LIQUIDATION 2
      await troveManager.liquidate(defaulter_2, DEFAULT_PRICE_FEED_DATA)
      assert.isFalse(await sortedTroves.contains(defaulter_2))

      blockTimestamp_2 = th.toBN(await th.getLatestBlockTimestamp(web3)) 
      timestampDiff = blockTimestamp_2.sub(blockTimestamp_1)

      th.assertIsApproximatelyEqual(await stabilityPool.getTotalUSDSDeposits(), dec(60000, 18))

      A_expected_accumulated = A_expected_accumulated.add(rewardPerSec.mul(A_CompoundedDeposit).div(totalUSDSDeposits).mul(timestampDiff));
      B_expected_accumulated = B_expected_accumulated.add(rewardPerSec.mul(B_CompoundedDeposit).div(totalUSDSDeposits).mul(timestampDiff));
      C_expected_accumulated = C_expected_accumulated.add(rewardPerSec.mul(C_CompoundedDeposit).div(totalUSDSDeposits).mul(timestampDiff));
      D_expected_accumulated = D_expected_accumulated.add(rewardPerSec.mul(D_CompoundedDeposit).div(totalUSDSDeposits).mul(timestampDiff));
      E_expected_accumulated = E_expected_accumulated.add(rewardPerSec.mul(E_CompoundedDeposit).div(totalUSDSDeposits).mul(timestampDiff));

      // --- CHECK GAINS AFTER L2 ---

      // During month 2, deposit sizes:  A:5000,   B:10000, C:15000,  D:20000, E:30000. Total: 80000

      // Expected gains for each depositor after month 2 
      const A_expectedSABLEGain_M2 = F1_kickbackRate.mul(A_expected_accumulated).div(toBN(dec(1, 18)))
      const B_expectedSABLEGain_M2 = F2_kickbackRate.mul(B_expected_accumulated).div(toBN(dec(1, 18)))
      const C_expectedSABLEGain_M2 = F2_kickbackRate.mul(C_expected_accumulated).div(toBN(dec(1, 18)))
      const D_expectedSABLEGain_M2 = D_expected_accumulated
      const E_expectedSABLEGain_M2 = F1_kickbackRate.mul(E_expected_accumulated).div(toBN(dec(1, 18)))

      // Check SABLE gains after month 2
      const A_SABLEGain_After_M2 = await stabilityPool.getDepositorSABLEGain(A)
      const B_SABLEGain_After_M2 = await stabilityPool.getDepositorSABLEGain(B)
      const C_SABLEGain_After_M2 = await stabilityPool.getDepositorSABLEGain(C)
      const D_SABLEGain_After_M2 = await stabilityPool.getDepositorSABLEGain(D)
      const E_SABLEGain_After_M2 = await stabilityPool.getDepositorSABLEGain(E)

      assert.isAtMost(getDifference(A_SABLEGain_After_M2, A_expectedSABLEGain_M2), 1e15)
      assert.isAtMost(getDifference(B_SABLEGain_After_M2, B_expectedSABLEGain_M2), 1e15)
      assert.isAtMost(getDifference(C_SABLEGain_After_M2, C_expectedSABLEGain_M2), 1e15)
      assert.isAtMost(getDifference(D_SABLEGain_After_M2, D_expectedSABLEGain_M2), 1e15)
      assert.isAtMost(getDifference(E_SABLEGain_After_M2, E_expectedSABLEGain_M2), 1e15)

      totalUSDSDeposits = await stabilityPool.getTotalUSDSDeposits();
      A_CompoundedDeposit = await stabilityPool.getCompoundedUSDSDeposit(A);
      B_CompoundedDeposit = await stabilityPool.getCompoundedUSDSDeposit(B);
      C_CompoundedDeposit = await stabilityPool.getCompoundedUSDSDeposit(C);
      D_CompoundedDeposit = await stabilityPool.getCompoundedUSDSDeposit(D);
      E_CompoundedDeposit = await stabilityPool.getCompoundedUSDSDeposit(E);

      // B tops up 40k via F2
      await stabilityPool.provideToSP(dec(40000, 18), frontEnd_2, { from: B })
      let B_SABLE_balance_checkpoint = await sableToken.balanceOf(B);
      let F2_balance_accumulated = toBN(dec(1, 18))
        .sub(F2_kickbackRate)
        .mul(B_expected_accumulated)
        .div(toBN(dec(1, 18)))

      A_expected_accumulated = A_expected_accumulated.add(rewardPerSec.mul(A_CompoundedDeposit).div(totalUSDSDeposits));
      B_expected_accumulated = toBN(0)
      C_expected_accumulated = C_expected_accumulated.add(rewardPerSec.mul(C_CompoundedDeposit).div(totalUSDSDeposits));
      D_expected_accumulated = D_expected_accumulated.add(rewardPerSec.mul(D_CompoundedDeposit).div(totalUSDSDeposits));
      E_expected_accumulated = E_expected_accumulated.add(rewardPerSec.mul(E_CompoundedDeposit).div(totalUSDSDeposits));

      totalUSDSDeposits = await stabilityPool.getTotalUSDSDeposits();
      A_CompoundedDeposit = await stabilityPool.getCompoundedUSDSDeposit(A);
      B_CompoundedDeposit = await stabilityPool.getCompoundedUSDSDeposit(B);
      C_CompoundedDeposit = await stabilityPool.getCompoundedUSDSDeposit(C);
      D_CompoundedDeposit = await stabilityPool.getCompoundedUSDSDeposit(D);
      E_CompoundedDeposit = await stabilityPool.getCompoundedUSDSDeposit(E);

      blockTimestamp_1 = th.toBN(await th.getLatestBlockTimestamp(web3))

      th.assertIsApproximatelyEqual(await stabilityPool.getTotalUSDSDeposits(), dec(100000, 18))

      // Month 3 passes
      await th.fastForwardTime(timeValues.SECONDS_IN_ONE_MONTH, web3.currentProvider)

      // LIQUIDATION 3
      await troveManager.liquidate(defaulter_3, DEFAULT_PRICE_FEED_DATA)
      assert.isFalse(await sortedTroves.contains(defaulter_3))

      blockTimestamp_2 = th.toBN(await th.getLatestBlockTimestamp(web3)) 
      timestampDiff = blockTimestamp_2.sub(blockTimestamp_1)

      A_expected_accumulated = A_expected_accumulated.add(rewardPerSec.mul(A_CompoundedDeposit).div(totalUSDSDeposits).mul(timestampDiff));
      B_expected_accumulated = B_expected_accumulated.add(rewardPerSec.mul(B_CompoundedDeposit).div(totalUSDSDeposits).mul(timestampDiff));
      C_expected_accumulated = C_expected_accumulated.add(rewardPerSec.mul(C_CompoundedDeposit).div(totalUSDSDeposits).mul(timestampDiff));
      D_expected_accumulated = D_expected_accumulated.add(rewardPerSec.mul(D_CompoundedDeposit).div(totalUSDSDeposits).mul(timestampDiff));
      E_expected_accumulated = E_expected_accumulated.add(rewardPerSec.mul(E_CompoundedDeposit).div(totalUSDSDeposits).mul(timestampDiff));

      th.assertIsApproximatelyEqual(await stabilityPool.getTotalUSDSDeposits(), dec(90000, 18))

      // --- CHECK GAINS AFTER L3 ---

      // During month 3, deposit sizes: A:3750, B:47500, C:11250, D:15000, E:22500, Total: 100000

      // Expected gains for each depositor after month 3 
      const A_expectedSABLEGain_M3 = F1_kickbackRate.mul(A_expected_accumulated).div(toBN(dec(1, 18)))
      const B_expectedSABLEGain_M3 = F2_kickbackRate.mul(B_expected_accumulated).div(toBN(dec(1, 18)))
      const C_expectedSABLEGain_M3 = F2_kickbackRate.mul(C_expected_accumulated).div(toBN(dec(1, 18)))
      const D_expectedSABLEGain_M3 = D_expected_accumulated
      const E_expectedSABLEGain_M3 = F1_kickbackRate.mul(E_expected_accumulated).div(toBN(dec(1, 18)))

      // Check SABLE gains after month 3
      const A_SABLEGain_After_M3 = await stabilityPool.getDepositorSABLEGain(A)
      const B_SABLEGain_After_M3 = await stabilityPool.getDepositorSABLEGain(B)
      const C_SABLEGain_After_M3 = await stabilityPool.getDepositorSABLEGain(C)
      const D_SABLEGain_After_M3 = await stabilityPool.getDepositorSABLEGain(D)
      const E_SABLEGain_After_M3 = await stabilityPool.getDepositorSABLEGain(E)

      // Expect A, C, D SABLE system gains to equal their gains from (M1 + M2 + M3)
      assert.isAtMost(getDifference(A_SABLEGain_After_M3, A_expectedSABLEGain_M3), 1e15)
      assert.isAtMost(getDifference(B_SABLEGain_After_M3, B_expectedSABLEGain_M3), 1e15)
      assert.isAtMost(getDifference(C_SABLEGain_After_M3, C_expectedSABLEGain_M3), 1e15)
      assert.isAtMost(getDifference(D_SABLEGain_After_M3, D_expectedSABLEGain_M3), 1e15)
      assert.isAtMost(getDifference(E_SABLEGain_After_M3, E_expectedSABLEGain_M3), 1e15)

      // Expect deposit C now to be 10125 USDS
      const C_compoundedUSDSDeposit = await stabilityPool.getCompoundedUSDSDeposit(C)
      assert.isAtMost(getDifference(C_compoundedUSDSDeposit, dec(10125, 18)), 1000)

      // --- C withdraws ---

      th.assertIsApproximatelyEqual(await stabilityPool.getTotalUSDSDeposits(), dec(90000, 18))

      totalUSDSDeposits = await stabilityPool.getTotalUSDSDeposits();
      A_CompoundedDeposit = await stabilityPool.getCompoundedUSDSDeposit(A);
      B_CompoundedDeposit = await stabilityPool.getCompoundedUSDSDeposit(B);
      C_CompoundedDeposit = await stabilityPool.getCompoundedUSDSDeposit(C);
      D_CompoundedDeposit = await stabilityPool.getCompoundedUSDSDeposit(D);
      E_CompoundedDeposit = await stabilityPool.getCompoundedUSDSDeposit(E);

      F2_balance_accumulated = F2_balance_accumulated.add(toBN(dec(1, 18))
        .sub(F2_kickbackRate)
        .mul(C_expected_accumulated)
        .div(toBN(dec(1, 18))))

      await stabilityPool.withdrawFromSP(dec(10000, 18), DEFAULT_PRICE_FEED_DATA, { from: C })
      let C_SABLE_balance_checkpoint = await sableToken.balanceOf(C);

      A_expected_accumulated = A_expected_accumulated.add(rewardPerSec.mul(A_CompoundedDeposit).div(totalUSDSDeposits));
      B_expected_accumulated = B_expected_accumulated.add(rewardPerSec.mul(B_CompoundedDeposit).div(totalUSDSDeposits));
      C_expected_accumulated = toBN(0)
      D_expected_accumulated = D_expected_accumulated.add(rewardPerSec.mul(D_CompoundedDeposit).div(totalUSDSDeposits));
      E_expected_accumulated = E_expected_accumulated.add(rewardPerSec.mul(E_CompoundedDeposit).div(totalUSDSDeposits));

      totalUSDSDeposits = await stabilityPool.getTotalUSDSDeposits();
      A_CompoundedDeposit = await stabilityPool.getCompoundedUSDSDeposit(A);
      B_CompoundedDeposit = await stabilityPool.getCompoundedUSDSDeposit(B);
      C_CompoundedDeposit = await stabilityPool.getCompoundedUSDSDeposit(C);
      D_CompoundedDeposit = await stabilityPool.getCompoundedUSDSDeposit(D);
      E_CompoundedDeposit = await stabilityPool.getCompoundedUSDSDeposit(E);

      blockTimestamp_1 = th.toBN(await th.getLatestBlockTimestamp(web3)) 

      th.assertIsApproximatelyEqual(await stabilityPool.getTotalUSDSDeposits(), dec(80000, 18))

      // Month 4 passes
      await th.fastForwardTime(timeValues.SECONDS_IN_ONE_MONTH, web3.currentProvider)

      blockTimestamp_2 = th.toBN(await th.getLatestBlockTimestamp(web3)) 
      timestampDiff = blockTimestamp_2.sub(blockTimestamp_1)

      // All depositors fully withdraw
      
      A_expected_accumulated = A_expected_accumulated.add(rewardPerSec.mul(A_CompoundedDeposit).div(totalUSDSDeposits).mul(timestampDiff));
      B_expected_accumulated = B_expected_accumulated.add(rewardPerSec.mul(B_CompoundedDeposit).div(totalUSDSDeposits).mul(timestampDiff));
      C_expected_accumulated = C_expected_accumulated.add(rewardPerSec.mul(C_CompoundedDeposit).div(totalUSDSDeposits).mul(timestampDiff));
      D_expected_accumulated = D_expected_accumulated.add(rewardPerSec.mul(D_CompoundedDeposit).div(totalUSDSDeposits).mul(timestampDiff));
      E_expected_accumulated = E_expected_accumulated.add(rewardPerSec.mul(E_CompoundedDeposit).div(totalUSDSDeposits).mul(timestampDiff));

      totalUSDSDeposits = await stabilityPool.getTotalUSDSDeposits();
      A_CompoundedDeposit = await stabilityPool.getCompoundedUSDSDeposit(A);
      B_CompoundedDeposit = await stabilityPool.getCompoundedUSDSDeposit(B);
      C_CompoundedDeposit = await stabilityPool.getCompoundedUSDSDeposit(C);
      D_CompoundedDeposit = await stabilityPool.getCompoundedUSDSDeposit(D);
      E_CompoundedDeposit = await stabilityPool.getCompoundedUSDSDeposit(E);
      A_expected_accumulated = A_expected_accumulated.add(rewardPerSec.mul(A_CompoundedDeposit).div(totalUSDSDeposits));
      B_expected_accumulated = B_expected_accumulated.add(rewardPerSec.mul(B_CompoundedDeposit).div(totalUSDSDeposits));
      C_expected_accumulated = C_expected_accumulated.add(rewardPerSec.mul(C_CompoundedDeposit).div(totalUSDSDeposits));
      D_expected_accumulated = D_expected_accumulated.add(rewardPerSec.mul(D_CompoundedDeposit).div(totalUSDSDeposits));
      E_expected_accumulated = E_expected_accumulated.add(rewardPerSec.mul(E_CompoundedDeposit).div(totalUSDSDeposits));

      await stabilityPool.withdrawFromSP(dec(100000, 18), DEFAULT_PRICE_FEED_DATA, { from: A })
      A_CompoundedDeposit = await stabilityPool.getCompoundedUSDSDeposit(A)
      assert.equal(A_CompoundedDeposit, '0')

      totalUSDSDeposits = await stabilityPool.getTotalUSDSDeposits();
      B_CompoundedDeposit = await stabilityPool.getCompoundedUSDSDeposit(B);
      C_CompoundedDeposit = await stabilityPool.getCompoundedUSDSDeposit(C);
      D_CompoundedDeposit = await stabilityPool.getCompoundedUSDSDeposit(D);
      E_CompoundedDeposit = await stabilityPool.getCompoundedUSDSDeposit(E);
      B_expected_accumulated = B_expected_accumulated.add(rewardPerSec.mul(B_CompoundedDeposit).div(totalUSDSDeposits));
      C_expected_accumulated = C_expected_accumulated.add(rewardPerSec.mul(C_CompoundedDeposit).div(totalUSDSDeposits));
      D_expected_accumulated = D_expected_accumulated.add(rewardPerSec.mul(D_CompoundedDeposit).div(totalUSDSDeposits));
      E_expected_accumulated = E_expected_accumulated.add(rewardPerSec.mul(E_CompoundedDeposit).div(totalUSDSDeposits));

      await stabilityPool.withdrawFromSP(dec(100000, 18), DEFAULT_PRICE_FEED_DATA, { from: B })
      B_CompoundedDeposit = await stabilityPool.getCompoundedUSDSDeposit(B)
      assert.equal(B_CompoundedDeposit, '0')

      F2_balance_accumulated = F2_balance_accumulated.add(toBN(dec(1, 18))
        .sub(F2_kickbackRate)
        .mul(B_expected_accumulated)
        .div(toBN(dec(1, 18))))

      totalUSDSDeposits = await stabilityPool.getTotalUSDSDeposits();
      C_CompoundedDeposit = await stabilityPool.getCompoundedUSDSDeposit(C);
      D_CompoundedDeposit = await stabilityPool.getCompoundedUSDSDeposit(D);
      E_CompoundedDeposit = await stabilityPool.getCompoundedUSDSDeposit(E);
      C_expected_accumulated = C_expected_accumulated.add(rewardPerSec.mul(C_CompoundedDeposit).div(totalUSDSDeposits));
      D_expected_accumulated = D_expected_accumulated.add(rewardPerSec.mul(D_CompoundedDeposit).div(totalUSDSDeposits));
      E_expected_accumulated = E_expected_accumulated.add(rewardPerSec.mul(E_CompoundedDeposit).div(totalUSDSDeposits));

      await stabilityPool.withdrawFromSP(dec(100000, 18), DEFAULT_PRICE_FEED_DATA, { from: C })
      C_CompoundedDeposit = await stabilityPool.getCompoundedUSDSDeposit(C)
      assert.equal(C_CompoundedDeposit, '0')

      F2_balance_accumulated = F2_balance_accumulated.add(toBN(dec(1, 18))
        .sub(F2_kickbackRate)
        .mul(C_expected_accumulated)
        .div(toBN(dec(1, 18))))

      totalUSDSDeposits = await stabilityPool.getTotalUSDSDeposits();
      D_CompoundedDeposit = await stabilityPool.getCompoundedUSDSDeposit(D);
      E_CompoundedDeposit = await stabilityPool.getCompoundedUSDSDeposit(E);
      D_expected_accumulated = D_expected_accumulated.add(rewardPerSec.mul(D_CompoundedDeposit).div(totalUSDSDeposits));
      E_expected_accumulated = E_expected_accumulated.add(rewardPerSec.mul(E_CompoundedDeposit).div(totalUSDSDeposits));

      await stabilityPool.withdrawFromSP(dec(100000, 18), DEFAULT_PRICE_FEED_DATA, { from: D })
      D_CompoundedDeposit = await stabilityPool.getCompoundedUSDSDeposit(D)
      assert.equal(D_CompoundedDeposit, '0')

      totalUSDSDeposits = await stabilityPool.getTotalUSDSDeposits();
      E_CompoundedDeposit = await stabilityPool.getCompoundedUSDSDeposit(E);
      E_expected_accumulated = E_expected_accumulated.add(rewardPerSec.mul(E_CompoundedDeposit).div(totalUSDSDeposits));

      await stabilityPool.withdrawFromSP(dec(100000, 18), DEFAULT_PRICE_FEED_DATA, { from: E })
      E_CompoundedDeposit = await stabilityPool.getCompoundedUSDSDeposit(E)
      assert.equal(E_CompoundedDeposit, '0')

      // During month 4, deposit sizes: A:3375, B:42750, C:125, D:13500, E:20250, Total: 80000

      // Expected gains for each depositor after month 4
      const A_expectedSABLEGain_M4 = F1_kickbackRate.mul(A_expected_accumulated).div(toBN(dec(1, 18)))
      const B_expectedSABLEGain_M4 = F2_kickbackRate.mul(B_expected_accumulated).div(toBN(dec(1, 18)))
      const C_expectedSABLEGain_M4 = F2_kickbackRate.mul(C_expected_accumulated).div(toBN(dec(1, 18)))
      const D_expectedSABLEGain_M4 = D_expected_accumulated
      const E_expectedSABLEGain_M4 = F1_kickbackRate.mul(E_expected_accumulated).div(toBN(dec(1, 18)))

      // F1's stake = A + E
      const F1_expectedSABLEGain_M4 = toBN(dec(1, 18))
        .sub(F1_kickbackRate)
        .mul(A_expected_accumulated.add(E_expected_accumulated))
        .div(toBN(dec(1, 18)))

      // F2's stake = B + C
      const F2_expectedSABLEGain_M4 = F2_balance_accumulated

      // Get final SABLE balances
      const A_FinalSABLEBalance = await sableToken.balanceOf(A)
      const B_FinalSABLEBalance = await sableToken.balanceOf(B)
      const C_FinalSABLEBalance = await sableToken.balanceOf(C)
      const D_FinalSABLEBalance = await sableToken.balanceOf(D)
      const E_FinalSABLEBalance = await sableToken.balanceOf(E)
      const F1_FinalSABLEBalance = await sableToken.balanceOf(frontEnd_1)
      const F2_FinalSABLEBalance = await sableToken.balanceOf(frontEnd_2)

      assert.isAtMost(getDifference(A_FinalSABLEBalance, A_expectedSABLEGain_M4), 1e15)
      assert.isAtMost(getDifference(B_FinalSABLEBalance, B_expectedSABLEGain_M4.add(B_SABLE_balance_checkpoint)), 1e15)
      assert.isAtMost(getDifference(C_FinalSABLEBalance, C_expectedSABLEGain_M4.add(C_SABLE_balance_checkpoint)), 1e15)
      assert.isAtMost(getDifference(D_FinalSABLEBalance, D_expectedSABLEGain_M4), 1e15)
      assert.isAtMost(getDifference(E_FinalSABLEBalance, E_expectedSABLEGain_M4), 1e15)
      assert.isAtMost(getDifference(F1_FinalSABLEBalance, F1_expectedSABLEGain_M4), 1e15)
      assert.isAtMost(getDifference(F2_FinalSABLEBalance, F2_expectedSABLEGain_M4), 5e16)
    })

    /* Serial scale changes, with one front end

    F1 kickbackRate: 80%

    A, B make deposit 5000 USDS via F1
    1 month passes. L1 depletes P: P = 1e-5*P L1:  9999.9 USDS, 1 BNB.  scale = 0
    C makes deposit 10000  via F1
    1 month passes. L2 depletes P: P = 1e-5*P L2:  9999.9 USDS, 1 BNB  scale = 1
    D makes deposit 10000 via F1
    1 month passes. L3 depletes P: P = 1e-5*P L3:  9999.9 USDS, 1 BNB scale = 1
    E makes deposit 10000 via F1
    1 month passes. L3 depletes P: P = 1e-5*P L4:  9999.9 USDS, 1 BNB scale = 2
    A, B, C, D, E withdraw

    =========
    Expect front end withdraws ~3 month's worth of SABLE */

    it("withdrawFromSP(): Several deposits of 10k USDS span one scale factor change. Depositors withdraw correct SABLE gains", async () => {
      const kickbackRate = toBN(dec(80, 16)) // F1 kicks 80% back to depositor
      await stabilityPool.registerFrontEnd(kickbackRate, { from: frontEnd_1 })

      let rewardPerSec = await communityIssuanceTester.latestRewardPerSec()

      // Whale opens Trove with 10k BNB
      await borrowerOperations.openTrove(th._100pct, dec(10000, 18), whale, whale, DEFAULT_PRICE_FEED_DATA, { from: whale, value: dec(10000, 'ether') })

      const _4_Defaulters = [defaulter_1, defaulter_2, defaulter_3, defaulter_4]

      for (const defaulter of _4_Defaulters) {
        // Defaulters 1-4 each withdraw to 9999.9 debt (including gas comp)
        await borrowerOperations.openTrove(th._100pct, await getOpenTroveUSDSAmount(dec(99999, 17)), defaulter, defaulter, DEFAULT_PRICE_FEED_DATA, { from: defaulter, value: dec(100, 'ether') })
      }

      // Confirm all would-be depositors have 0 SABLE
      for (const depositor of [A, B, C, D, E]) {
        assert.equal(await sableToken.balanceOf(depositor), '0')
      }
      assert.equal(await sableToken.balanceOf(frontEnd_1), '0')

      // price drops by 50%
      await priceFeed.setPrice(dec(100, 18));

      // Check scale is 0
      assert.equal(await stabilityPool.currentScale(), '0')

      // A, B provides 5000 USDS to SP
      await borrowerOperations.openTrove(th._100pct, dec(5000, 18), A, A, DEFAULT_PRICE_FEED_DATA, { from: A, value: dec(200, 'ether') })
      await borrowerOperations.openTrove(th._100pct, dec(5000, 18), B, B, DEFAULT_PRICE_FEED_DATA, { from: B, value: dec(200, 'ether') })
      await borrowerOperations.openTrove(th._100pct, dec(99999, 17), C, C, DEFAULT_PRICE_FEED_DATA, { from: C, value: dec(200, 'ether') })
      await borrowerOperations.openTrove(th._100pct, dec(99999, 17), D, D, DEFAULT_PRICE_FEED_DATA, { from: D, value: dec(200, 'ether') })
      await borrowerOperations.openTrove(th._100pct, dec(99999, 17), E, E, DEFAULT_PRICE_FEED_DATA, { from: E, value: dec(200, 'ether') })

      await stabilityPool.provideToSP(dec(5000, 18), frontEnd_1, { from: A })
      await stabilityPool.provideToSP(dec(5000, 18), frontEnd_1, { from: B })

      let blockTimestamp_1 = th.toBN(await th.getLatestBlockTimestamp(web3)) 

      // 1 month passes (M1)
      await th.fastForwardTime(timeValues.SECONDS_IN_ONE_MONTH, web3.currentProvider)

      // Defaulter 1 liquidated.  Value of P updated to  to 9999999, i.e. in decimal, ~1e-10
      const txL1 = await troveManager.liquidate(defaulter_1, DEFAULT_PRICE_FEED_DATA, { from: owner });
      assert.isFalse(await sortedTroves.contains(defaulter_1))
      assert.isTrue(txL1.receipt.status)

      let blockTimestamp_2 = th.toBN(await th.getLatestBlockTimestamp(web3)) 
      let timestampDiff = blockTimestamp_2.sub(blockTimestamp_1)

      let A_expected_accumulated = rewardPerSec.add(rewardPerSec.div(toBN(2)).mul(timestampDiff))
      let B_expected_accumulated = rewardPerSec.div(toBN(2)).mul(timestampDiff)
      let A_CompoundedDeposit = await stabilityPool.getCompoundedUSDSDeposit(A)
      let B_CompoundedDeposit = await stabilityPool.getCompoundedUSDSDeposit(B)
      let totalUSDSDeposits = await stabilityPool.getTotalUSDSDeposits()

      // Check scale is 0
      assert.equal(await stabilityPool.currentScale(), '0')

      // C provides to SP
      await stabilityPool.provideToSP(dec(99999, 17), frontEnd_1, { from: C })

      A_expected_accumulated = A_expected_accumulated.add(rewardPerSec.mul(A_CompoundedDeposit).div(totalUSDSDeposits))
      B_expected_accumulated = B_expected_accumulated.add(rewardPerSec.mul(B_CompoundedDeposit).div(totalUSDSDeposits))
      let C_CompoundedDeposit = await stabilityPool.getCompoundedUSDSDeposit(C)
      totalUSDSDeposits = await stabilityPool.getTotalUSDSDeposits()

      blockTimestamp_1 = th.toBN(await th.getLatestBlockTimestamp(web3)) 

      // 1 month passes (M2)
      await th.fastForwardTime(timeValues.SECONDS_IN_ONE_MONTH, web3.currentProvider)

      // Defaulter 2 liquidated
      const txL2 = await troveManager.liquidate(defaulter_2, DEFAULT_PRICE_FEED_DATA, { from: owner });
      assert.isFalse(await sortedTroves.contains(defaulter_2))
      assert.isTrue(txL2.receipt.status)

      blockTimestamp_2 = th.toBN(await th.getLatestBlockTimestamp(web3)) 
      timestampDiff = blockTimestamp_2.sub(blockTimestamp_1)

      A_expected_accumulated = A_expected_accumulated.add(rewardPerSec.mul(A_CompoundedDeposit).div(totalUSDSDeposits).mul(timestampDiff))
      B_expected_accumulated = B_expected_accumulated.add(rewardPerSec.mul(B_CompoundedDeposit).div(totalUSDSDeposits).mul(timestampDiff))
      let C_expected_accumulated = rewardPerSec.mul(C_CompoundedDeposit).div(totalUSDSDeposits).mul(timestampDiff)

      A_CompoundedDeposit = await stabilityPool.getCompoundedUSDSDeposit(A)
      B_CompoundedDeposit = await stabilityPool.getCompoundedUSDSDeposit(B)
      C_CompoundedDeposit = await stabilityPool.getCompoundedUSDSDeposit(C)
      totalUSDSDeposits = await stabilityPool.getTotalUSDSDeposits()

      // Check scale is 1
      assert.equal(await stabilityPool.currentScale(), '1')

      // D provides to SP
      await stabilityPool.provideToSP(dec(99999, 17), frontEnd_1, { from: D })

      A_expected_accumulated = A_expected_accumulated.add(rewardPerSec.mul(A_CompoundedDeposit).div(totalUSDSDeposits))
      B_expected_accumulated = B_expected_accumulated.add(rewardPerSec.mul(B_CompoundedDeposit).div(totalUSDSDeposits))
      C_expected_accumulated = C_expected_accumulated.add(rewardPerSec.mul(C_CompoundedDeposit).div(totalUSDSDeposits))
      let D_CompoundedDeposit = await stabilityPool.getCompoundedUSDSDeposit(D)
      totalUSDSDeposits = await stabilityPool.getTotalUSDSDeposits()

      blockTimestamp_1 = th.toBN(await th.getLatestBlockTimestamp(web3))

      // 1 month passes (M3)
      await th.fastForwardTime(timeValues.SECONDS_IN_ONE_MONTH, web3.currentProvider)

      // Defaulter 3 liquidated
      const txL3 = await troveManager.liquidate(defaulter_3, DEFAULT_PRICE_FEED_DATA, { from: owner });
      assert.isFalse(await sortedTroves.contains(defaulter_3))
      assert.isTrue(txL3.receipt.status)

      blockTimestamp_2 = th.toBN(await th.getLatestBlockTimestamp(web3)) 
      timestampDiff = blockTimestamp_2.sub(blockTimestamp_1)

      A_expected_accumulated = A_expected_accumulated.add(rewardPerSec.mul(A_CompoundedDeposit).div(totalUSDSDeposits).mul(timestampDiff))
      B_expected_accumulated = B_expected_accumulated.add(rewardPerSec.mul(B_CompoundedDeposit).div(totalUSDSDeposits).mul(timestampDiff))
      C_expected_accumulated = C_expected_accumulated.add(rewardPerSec.mul(C_CompoundedDeposit).div(totalUSDSDeposits).mul(timestampDiff))

      let D_expected_accumulated = rewardPerSec.mul(D_CompoundedDeposit).div(totalUSDSDeposits).mul(timestampDiff)

      A_CompoundedDeposit = await stabilityPool.getCompoundedUSDSDeposit(A)
      B_CompoundedDeposit = await stabilityPool.getCompoundedUSDSDeposit(B)
      C_CompoundedDeposit = await stabilityPool.getCompoundedUSDSDeposit(C)
      D_CompoundedDeposit = await stabilityPool.getCompoundedUSDSDeposit(D)
      totalUSDSDeposits = await stabilityPool.getTotalUSDSDeposits()

      // Check scale is 1
      assert.equal(await stabilityPool.currentScale(), '1')

      // E provides to SP
      await stabilityPool.provideToSP(dec(99999, 17), frontEnd_1, { from: E })

      A_expected_accumulated = A_expected_accumulated.add(rewardPerSec.mul(A_CompoundedDeposit).div(totalUSDSDeposits))
      B_expected_accumulated = B_expected_accumulated.add(rewardPerSec.mul(B_CompoundedDeposit).div(totalUSDSDeposits))
      C_expected_accumulated = C_expected_accumulated.add(rewardPerSec.mul(C_CompoundedDeposit).div(totalUSDSDeposits))
      D_expected_accumulated = D_expected_accumulated.add(rewardPerSec.mul(D_CompoundedDeposit).div(totalUSDSDeposits))

      let E_CompoundedDeposit = await stabilityPool.getCompoundedUSDSDeposit(E)
      totalUSDSDeposits = await stabilityPool.getTotalUSDSDeposits()

      blockTimestamp_1 = th.toBN(await th.getLatestBlockTimestamp(web3))

      // 1 month passes (M4)
      await th.fastForwardTime(timeValues.SECONDS_IN_ONE_MONTH, web3.currentProvider)

      // Defaulter 4 liquidated
      const txL4 = await troveManager.liquidate(defaulter_4, DEFAULT_PRICE_FEED_DATA, { from: owner });
      assert.isFalse(await sortedTroves.contains(defaulter_4))
      assert.isTrue(txL4.receipt.status)

      blockTimestamp_2 = th.toBN(await th.getLatestBlockTimestamp(web3)) 
      timestampDiff = blockTimestamp_2.sub(blockTimestamp_1)

      A_expected_accumulated = A_expected_accumulated.add(rewardPerSec.mul(A_CompoundedDeposit).div(totalUSDSDeposits).mul(timestampDiff))
      B_expected_accumulated = B_expected_accumulated.add(rewardPerSec.mul(B_CompoundedDeposit).div(totalUSDSDeposits).mul(timestampDiff))
      C_expected_accumulated = C_expected_accumulated.add(rewardPerSec.mul(C_CompoundedDeposit).div(totalUSDSDeposits).mul(timestampDiff))
      D_expected_accumulated = D_expected_accumulated.add(rewardPerSec.mul(D_CompoundedDeposit).div(totalUSDSDeposits).mul(timestampDiff))

      let E_expected_accumulated = rewardPerSec.mul(E_CompoundedDeposit).div(totalUSDSDeposits).mul(timestampDiff)

      totalUSDSDeposits = await stabilityPool.getTotalUSDSDeposits()
      E_CompoundedDeposit = await stabilityPool.getCompoundedUSDSDeposit(E)

      // Check scale is 2
      assert.equal(await stabilityPool.currentScale(), '2')

      /* All depositors withdraw fully from SP.  Withdraw in reverse order, so that the largest remaining
      deposit (F) withdraws first, and does not get extra SABLE gains from the periods between withdrawals */
      E_expected_accumulated = E_expected_accumulated.add(rewardPerSec.mul(E_CompoundedDeposit).div(totalUSDSDeposits))
      await stabilityPool.withdrawFromSP(dec(10000, 18), DEFAULT_PRICE_FEED_DATA, { from: E })

      D_expected_accumulated = D_expected_accumulated.add(rewardPerSec.mul(D_CompoundedDeposit).div(totalUSDSDeposits))
      await stabilityPool.withdrawFromSP(dec(10000, 18), DEFAULT_PRICE_FEED_DATA, { from: D })
      await stabilityPool.withdrawFromSP(dec(10000, 18), DEFAULT_PRICE_FEED_DATA, { from: C })
      await stabilityPool.withdrawFromSP(dec(10000, 18), DEFAULT_PRICE_FEED_DATA, { from: B })
      await stabilityPool.withdrawFromSP(dec(10000, 18), DEFAULT_PRICE_FEED_DATA, { from: A })

      const SABLEGain_A = await sableToken.balanceOf(A)
      const SABLEGain_B = await sableToken.balanceOf(B)
      const SABLEGain_C = await sableToken.balanceOf(C)
      const SABLEGain_D = await sableToken.balanceOf(D)
      const SABLEGain_E = await sableToken.balanceOf(E)

      const SABLEGain_F1 = await sableToken.balanceOf(frontEnd_1)

      const A_TotalGain = A_expected_accumulated.mul(kickbackRate).div(toBN(dec(1, 18)))
      const B_TotalGain = B_expected_accumulated.mul(kickbackRate).div(toBN(dec(1, 18)))
      const C_TotalGain = C_expected_accumulated.mul(kickbackRate).div(toBN(dec(1, 18)))
      const D_TotalGain = D_expected_accumulated.mul(kickbackRate).div(toBN(dec(1, 18)))
      const E_TotalGain = E_expected_accumulated.mul(kickbackRate).div(toBN(dec(1, 18)))

      const issuance1st4Months = A_expected_accumulated.add(B_expected_accumulated).add(C_expected_accumulated).add(D_expected_accumulated).add(E_expected_accumulated)
      const expectedSABLEGain_F1 = (toBN(dec(1, 18)).sub(kickbackRate)).mul(issuance1st4Months).div(toBN(dec(1, 18)))

      assert.isAtMost(getDifference(A_TotalGain, SABLEGain_A), 1e15)
      assert.isAtMost(getDifference(B_TotalGain, SABLEGain_B), 1e15)
      assert.isAtMost(getDifference(C_TotalGain, SABLEGain_C), 1e15)
      assert.isAtMost(getDifference(D_TotalGain, SABLEGain_D), 1e15)
      assert.isAtMost(getDifference(E_TotalGain, SABLEGain_E), 1e15)
      assert.isAtMost(getDifference(expectedSABLEGain_F1, SABLEGain_F1), 1e18)

    })

    /* Contract owner update reward per second */

  })
})

contract('Reset chain state', async accounts => { })