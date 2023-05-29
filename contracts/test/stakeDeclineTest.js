const deploymentHelper = require("../utils/deploymentHelpers.js")
const testHelpers = require("../utils/testHelpers.js")
const TroveManagerTester = artifacts.require("./TroveManagerTester.sol")
const USDSTokenTester = artifacts.require("./USDSTokenTester.sol")

const th = testHelpers.TestHelper
const dec = th.dec
const toBN = th.toBN
const assertRevert = th.assertRevert
const mv = testHelpers.MoneyValues
const timeValues = testHelpers.TimeValues

const DEFAULT_PRICE_FEED_DATA = testHelpers.DEFAULT_PRICE_FEED_DATA


/* NOTE: Some tests involving BNB redemption fees do not test for specific fee values.
 * Some only test that the fees are non-zero when they should occur.
 *
 * Specific BNB gain values will depend on the final fee schedule used, and the final choices for
 * the parameter BETA in the TroveManager, which is still TBD based on economic modelling.
 * 
 */
contract('TroveManager', async accounts => {

  const ZERO_ADDRESS = th.ZERO_ADDRESS
  const [owner, A, B, C, D, E, F] = accounts.slice(0, 7);
  const funder = accounts[10];

  const [vaultAddress, lpRewardsAddress, multisig] = accounts.slice(997, 1000)

  let priceFeed
  let usdsToken
  let sortedTroves
  let troveManager
  let activePool
  let stabilityPool
  let collSurplusPool
  let defaultPool
  let borrowerOperations
  let hintHelpers

  let contracts

  const getOpenTroveUSDSAmount = async (totalDebt) => th.getOpenTroveUSDSAmount(contracts, totalDebt)
 
  const getSnapshotsRatio = async () => {
    const ratio = (await troveManager.totalStakesSnapshot())
      .mul(toBN(dec(1, 18)))
      .div((await troveManager.totalCollateralSnapshot()))

    return ratio
  }

  beforeEach(async () => {
    contracts = await deploymentHelper.deployLiquityCore()
    contracts.troveManager = await TroveManagerTester.new()
    contracts.usdsToken = await USDSTokenTester.new(
      contracts.troveManager.address,
      contracts.stabilityPool.address,
      contracts.borrowerOperations.address
    )
    const MINT_AMOUNT = toBN(dec(100, 18))
    const SABLEContracts = await deploymentHelper.deploySABLEContracts(vaultAddress, MINT_AMOUNT)

    priceFeed = contracts.priceFeedTestnet
    usdsToken = contracts.usdsToken
    sortedTroves = contracts.sortedTroves
    troveManager = contracts.troveManager
    activePool = contracts.activePool
    stabilityPool = contracts.stabilityPool
    defaultPool = contracts.defaultPool
    collSurplusPool = contracts.collSurplusPool
    borrowerOperations = contracts.borrowerOperations
    hintHelpers = contracts.hintHelpers

    sableStaking = SABLEContracts.sableStaking
    sableToken = SABLEContracts.sableToken
    communityIssuance = SABLEContracts.communityIssuance
    lockupContractFactory = SABLEContracts.lockupContractFactory

    await deploymentHelper.connectCoreContracts(contracts, SABLEContracts)
    await deploymentHelper.connectSABLEContractsToCore(SABLEContracts, contracts)

    // funding PriceFeed contract
    await web3.eth.sendTransaction({from: funder, to: priceFeed.address, value: 1000000000})
  })

  it("A given trove's stake decline is negligible with adjustments and tiny liquidations", async () => {
    await priceFeed.setPrice(dec(100, 18))
  
    // Make 1 mega troves A at ~50% total collateral
    await borrowerOperations.openTrove(th._100pct, await getOpenTroveUSDSAmount(dec(1, 31)), ZERO_ADDRESS, ZERO_ADDRESS, DEFAULT_PRICE_FEED_DATA, { from: A, value: dec(2, 29) })
    
    // Make 5 large troves B, C, D, E, F at ~10% total collateral
    await borrowerOperations.openTrove(th._100pct, await getOpenTroveUSDSAmount(dec(2, 30)), ZERO_ADDRESS, ZERO_ADDRESS, DEFAULT_PRICE_FEED_DATA, { from: B, value: dec(4, 28) })
    await borrowerOperations.openTrove(th._100pct, await getOpenTroveUSDSAmount(dec(2, 30)), ZERO_ADDRESS, ZERO_ADDRESS, DEFAULT_PRICE_FEED_DATA, { from: C, value: dec(4, 28) })
    await borrowerOperations.openTrove(th._100pct, await getOpenTroveUSDSAmount(dec(2, 30)), ZERO_ADDRESS, ZERO_ADDRESS, DEFAULT_PRICE_FEED_DATA, { from: D, value: dec(4, 28) })
    await borrowerOperations.openTrove(th._100pct, await getOpenTroveUSDSAmount(dec(2, 30)), ZERO_ADDRESS, ZERO_ADDRESS, DEFAULT_PRICE_FEED_DATA, { from: E, value: dec(4, 28) })
    await borrowerOperations.openTrove(th._100pct, await getOpenTroveUSDSAmount(dec(2, 30)), ZERO_ADDRESS, ZERO_ADDRESS, DEFAULT_PRICE_FEED_DATA, { from: F, value: dec(4, 28) })
  
    // Make 10 tiny troves at relatively negligible collateral (~1e-9 of total)
    const tinyTroves = accounts.slice(10, 20)
    for (account of tinyTroves) {
      await borrowerOperations.openTrove(th._100pct, await getOpenTroveUSDSAmount(dec(1, 22)), ZERO_ADDRESS, ZERO_ADDRESS, DEFAULT_PRICE_FEED_DATA, { from: account, value: dec(2, 20) })
    }

    // liquidate 1 trove at ~50% total system collateral
    await priceFeed.setPrice(dec(50, 18))
    assert.isTrue(await troveManager.checkRecoveryMode(await priceFeed.getPrice()))
    await troveManager.liquidate(A, DEFAULT_PRICE_FEED_DATA)

    console.log(`totalStakesSnapshot after L1: ${await troveManager.totalStakesSnapshot()}`)
    console.log(`totalCollateralSnapshot after L1: ${await troveManager.totalCollateralSnapshot()}`)
    console.log(`Snapshots ratio after L1: ${await getSnapshotsRatio()}`)
    console.log(`B pending BNB reward after L1: ${await troveManager.getPendingBNBReward(B)}`)
    console.log(`B stake after L1: ${(await troveManager.Troves(B))[2]}`)

    // adjust trove B 1 wei: apply rewards
    let adjustTroveParam1 = {
      collWithdrawal: 0,
      USDSChange: 1,
      isDebtIncrease: false,
      upperHint: ZERO_ADDRESS,
      lowerHint: ZERO_ADDRESS,
      maxFeePercentage: th._100pct
    }
    await borrowerOperations.adjustTrove(adjustTroveParam1, DEFAULT_PRICE_FEED_DATA, {from: B})  // B repays 1 wei
    console.log(`B stake after A1: ${(await troveManager.Troves(B))[2]}`)
    console.log(`Snapshots ratio after A1: ${await getSnapshotsRatio()}`)

    // Loop over tiny troves, and alternately:
    // - Liquidate a tiny trove
    // - Adjust B's collateral by 1 wei
    for (let [idx, trove] of tinyTroves.entries()) {
      await troveManager.liquidate(trove, DEFAULT_PRICE_FEED_DATA)
      console.log(`B stake after L${idx + 2}: ${(await troveManager.Troves(B))[2]}`)
      console.log(`Snapshots ratio after L${idx + 2}: ${await getSnapshotsRatio()}`)
      let adjustTroveParam2 = {
        collWithdrawal: 0,
        USDSChange: 1,
        isDebtIncrease: false,
        upperHint: ZERO_ADDRESS,
        lowerHint: ZERO_ADDRESS,
        maxFeePercentage: th._100pct
      }
      await borrowerOperations.adjustTrove(adjustTroveParam2, DEFAULT_PRICE_FEED_DATA, {from: B})  // A repays 1 wei
      console.log(`B stake after A${idx + 2}: ${(await troveManager.Troves(B))[2]}`)
    }
  })

  // TODO: stake decline for adjustments with sizable liquidations, for comparison
})