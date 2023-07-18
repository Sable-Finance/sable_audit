const deploymentHelpers = require("../utils/deploymentHelpers.js")
const testHelpers = require("../utils/testHelpers.js")
const TroveManagerTester = artifacts.require("TroveManagerTester")
const USDSTokenTester = artifacts.require("./USDSTokenTester.sol")

const deployLiquity = deploymentHelpers.deployLiquity
const getAddresses = deploymentHelpers.getAddresses
const connectContracts = deploymentHelpers.connectContracts

const th  = testHelpers.TestHelper
const dec = th.dec
const toBN = th.toBN
const ZERO_ADDRESS = th.ZERO_ADDRESS;

const DEFAULT_PRICE_FEED_DATA = testHelpers.DEFAULT_PRICE_FEED_DATA

contract('Pool Manager: Sum-Product rounding errors', async accounts => {

  const whale = accounts[0]
  const [vaultAddress, lpRewardsAddress, multisig] = accounts.slice(997, 1000);

  let contracts

  let priceFeed
  let usdsToken
  let stabilityPool
  let troveManager
  let borrowerOperations
  const openTrove = async params => th.openTrove(contracts, params);

  beforeEach(async () => {
    contracts = await deploymentHelpers.deployLiquityCore()
    contracts.troveManager = await TroveManagerTester.new();
    const MINT_AMOUNT = toBN(dec(100000000, 18))
    const SABLEContracts = await deploymentHelpers.deploySABLETesterContractsHardhat(
      vaultAddress,
      MINT_AMOUNT
    );
    contracts.usdsToken = await USDSTokenTester.new(
      contracts.troveManager.address,
      contracts.stabilityPool.address,
      contracts.borrowerOperations.address
    )
    
    priceFeed = contracts.priceFeedTestnet
    usdsToken = contracts.usdsToken
    stabilityPool = contracts.stabilityPool
    troveManager = contracts.troveManager
    borrowerOperations = contracts.borrowerOperations

    await deploymentHelpers.connectCoreContracts(contracts, SABLEContracts)
    await deploymentHelpers.connectSABLEContractsToCore(SABLEContracts, contracts)
  })

  it("Rounding errors: 100 deposits of 100USDS into SP, then 200 liquidations of 49USDS", async () => {
    const owner = accounts[0]
    const depositors = accounts.slice(1, 101)
    const defaulters = accounts.slice(101, 301)

    for (let account of depositors) {
      await openTrove({ extraUSDSAmount: toBN(dec(10000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: account } })
      await stabilityPool.provideToSP(dec(100, 18), ZERO_ADDRESS, { from: account })
    }

    // Defaulter opens trove with 200% ICR
    for (let defaulter of defaulters) {
      await openTrove({ ICR: toBN(dec(2, 18)), extraParams: { from: defaulter } })
    }
    const price = await priceFeed.getPrice()

    // price drops by 50%: defaulter ICR falls to 100%
    await priceFeed.setPrice(dec(105, 18));

    // Defaulters liquidated
    for (let defaulter of defaulters) {
      await troveManager.liquidate(defaulter, DEFAULT_PRICE_FEED_DATA);
    }

    const SP_TotalDeposits = await stabilityPool.getTotalUSDSDeposits()
    const SP_BNB = await stabilityPool.getBNB()
    const compoundedDeposit = await stabilityPool.getCompoundedUSDSDeposit(depositors[0])
    const BNB_Gain = await stabilityPool.getDepositorBNBGain(depositors[0])

    // Check depostiors receive their share without too much error
    assert.isAtMost(th.getDifference(SP_TotalDeposits.div(th.toBN(depositors.length)), compoundedDeposit), 100000)
    assert.isAtMost(th.getDifference(SP_BNB.div(th.toBN(depositors.length)), BNB_Gain), 100000)
  })
})

contract('Reset chain state', async accounts => { })