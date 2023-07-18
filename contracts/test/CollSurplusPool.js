const deploymentHelper = require("../utils/deploymentHelpers.js")
const testHelpers = require("../utils/testHelpers.js")
const NonPayable = artifacts.require('NonPayable.sol')

const th = testHelpers.TestHelper
const dec = th.dec
const toBN = th.toBN
const mv = testHelpers.MoneyValues
const timeValues = testHelpers.TimeValues

const DEFAULT_ORACLE_RATE = testHelpers.DEFAULT_ORACLE_RATE
const DEFAULT_PRICE_FEED_DATA = testHelpers.DEFAULT_PRICE_FEED_DATA

const TroveManagerTester = artifacts.require("TroveManagerTester")
const USDSToken = artifacts.require("USDSToken")

contract('CollSurplusPool', async accounts => {
  const [
    owner,
    A, B, C, D, E, funder] = accounts;

  const [bountyAddress, lpRewardsAddress, multisig] = accounts.slice(997, 1000)

  let borrowerOperations
  let priceFeed
  let collSurplusPool

  let contracts

  const getOpenTroveUSDSAmount = async (totalDebt) => th.getOpenTroveUSDSAmount(contracts, totalDebt)
  const openTrove = async (params) => th.openTrove(contracts, params)

  beforeEach(async () => {
    contracts = await deploymentHelper.deployLiquityCore()
    contracts.troveManager = await TroveManagerTester.new()
    contracts.usdsToken = await USDSToken.new(
      contracts.troveManager.address,
      contracts.stabilityPool.address,
      contracts.borrowerOperations.address
    )
    const SABLEContracts = await deploymentHelper.deploySABLEContracts(bountyAddress, lpRewardsAddress, multisig)

    priceFeed = contracts.priceFeedTestnet
    collSurplusPool = contracts.collSurplusPool
    borrowerOperations = contracts.borrowerOperations

    await deploymentHelper.connectCoreContracts(contracts, SABLEContracts)
    
    await deploymentHelper.connectSABLEContractsToCore(SABLEContracts, contracts)

    // funding PriceFeed contract
    await web3.eth.sendTransaction({from: funder, to: priceFeed.address, value: 1000000000})
  })

  it("CollSurplusPool::getBNB(): Returns the BNB balance of the CollSurplusPool after redemption", async () => {
    const BNB_1 = await collSurplusPool.getBNB()
    assert.equal(BNB_1, '0')

    const price = toBN(dec(100, 18))
    await priceFeed.setPrice(price)

    const { collateral: B_coll, netDebt: B_netDebt } = await openTrove({ ICR: toBN(dec(200, 16)), extraParams: { from: B } })
    await openTrove({ extraUSDSAmount: B_netDebt, extraParams: { from: A, value: dec(3000, 'ether') } })

    // skip bootstrapping phase
    await th.fastForwardTime(timeValues.SECONDS_IN_ONE_WEEK * 2, web3.currentProvider)

    // At BNB:USD = 100, this redemption should leave 1 ether of coll surplus
    await th.redeemCollateralAndGetTxObject(A, contracts, B_netDebt)

    const BNB_2 = await collSurplusPool.getBNB()
    // th.assertIsApproximatelyEqual(BNB_2, B_coll.sub(B_netDebt.mul(mv._1e18BN).div(price)))
  })

  it("CollSurplusPool: claimColl(): Reverts if caller is not Borrower Operations", async () => {
    await th.assertRevert(collSurplusPool.claimColl(A, { from: A }), 'CollSurplusPool: Caller is not Borrower Operations')
  })

  it("CollSurplusPool: claimColl(): Reverts if nothing to claim", async () => {
    await th.assertRevert(borrowerOperations.claimCollateral({ from: A }), 'CollSurplusPool: No collateral available to claim')
  })

  it("CollSurplusPool: claimColl(): Reverts if owner cannot receive BNB surplus", async () => {
    const nonPayable = await NonPayable.new();

    const price = toBN(dec(100, 18));
    await priceFeed.setPrice(price);

    // open trove from NonPayable proxy contract
    const B_coll = toBN(dec(60, 18));
    const B_usdsAmount = toBN(dec(3000, 18));
    const B_netDebt = await th.getAmountWithBorrowingFee(
      contracts,
      B_usdsAmount,
      DEFAULT_ORACLE_RATE
    );
    const openTroveData = th
      .getTransactionData("openTrove(uint256,uint256,address,address,bytes[])", [
        "0xde0b6b3a7640000",
        web3.utils.toHex(B_usdsAmount),
        B,
        B
      ])
      .concat(
        "00000000000000000000000000000000000000000000000000000000000000a000000000000000000000000000000000000000000000000000000000000000010000000000000000000000000000000000000000000000000000000000000020000000000000000000000000000000000000000000000000000000000000039b"
      )
      .concat(DEFAULT_PRICE_FEED_DATA[0].slice(2));
    await nonPayable.forward(borrowerOperations.address, openTroveData, {
      value: B_coll,
      gas: 15000000
    });
    await openTrove({
      extraUSDSAmount: B_netDebt,
      extraParams: { from: A, value: dec(3000, "ether") }
    });

    // skip bootstrapping phase
    await th.fastForwardTime(timeValues.SECONDS_IN_ONE_WEEK * 2, web3.currentProvider);

    // At BNB:USD = 100, this redemption should leave 1 ether of coll surplus for B
    await th.redeemCollateralAndGetTxObject(A, contracts, B_netDebt);

    const BNB_2 = await collSurplusPool.getBNB();
    th.assertIsApproximatelyEqual(BNB_2, B_coll.sub(B_netDebt.mul(mv._1e18BN).div(price)));

    const claimCollateralData = th.getTransactionData("claimCollateral()", []);
    await th.assertRevert(
      nonPayable.forward(borrowerOperations.address, claimCollateralData),
      "CollSurplusPool: sending BNB failed"
    );
  });

  it('CollSurplusPool: reverts trying to send BNB to it', async () => {
    await th.assertRevert(web3.eth.sendTransaction({ from: A, to: collSurplusPool.address, value: 1 }), 'CollSurplusPool: Caller is not Active Pool')
  })

  it('CollSurplusPool: accountSurplus: reverts if caller is not Trove Manager', async () => {
    await th.assertRevert(collSurplusPool.accountSurplus(A, 1), 'CollSurplusPool: Caller is not TroveManager')
  })
})

contract('Reset chain state', async accounts => { })
