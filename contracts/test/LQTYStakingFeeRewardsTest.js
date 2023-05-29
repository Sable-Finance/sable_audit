const Decimal = require("decimal.js");
const deploymentHelper = require("../utils/deploymentHelpers.js")
const { BNConverter } = require("../utils/BNConverter.js")
const testHelpers = require("../utils/testHelpers.js")

const SABLEStakingTester = artifacts.require('SABLEStakingTester')
const TroveManagerTester = artifacts.require("TroveManagerTester")
const NonPayable = artifacts.require("./NonPayable.sol")

const th = testHelpers.TestHelper
const timeValues = testHelpers.TimeValues
const dec = th.dec
const assertRevert = th.assertRevert

const DEFAULT_PRICE_FEED_DATA = testHelpers.DEFAULT_PRICE_FEED_DATA

const toBN = th.toBN
const ZERO = th.toBN('0')

const GAS_PRICE = 10000000

/* NOTE: These tests do not test for specific BNB and USDS gain values. They only test that the 
 * gains are non-zero, occur when they should, and are in correct proportion to the user's stake. 
 *
 * Specific BNB/USDS gain values will depend on the final fee schedule used, and the final choices for
 * parameters BETA and MINUTE_DECAY_FACTOR in the TroveManager, which are still TBD based on economic
 * modelling.
 * 
 */ 

contract('SABLEStaking revenue share tests', async accounts => {

  const [vaultAddress, lpRewardsAddress, multisig] = accounts.slice(997, 1000)
  
  const [owner, A, B, C, D, E, F, G, whale, funder] = accounts;

  let priceFeed
  let usdsToken
  let sortedTroves
  let troveManager
  let activePool
  let stabilityPool
  let defaultPool
  let borrowerOperations
  let sableStaking
  let sableToken
  let troveHelper

  let contracts

  const openTrove = async (params) => th.openTrove(contracts, params)

  const MINT_AMOUNT = toBN(dec(1000, 18))

  beforeEach(async () => {
    contracts = await deploymentHelper.deployLiquityCore()
    contracts.troveManager = await TroveManagerTester.new()
    contracts = await deploymentHelper.deployUSDSTokenTester(contracts)
    const SABLEContracts = await deploymentHelper.deploySABLETesterContractsHardhat(vaultAddress, MINT_AMOUNT)
    
    await deploymentHelper.connectCoreContracts(contracts, SABLEContracts)
    await deploymentHelper.connectSABLEContractsToCore(SABLEContracts, contracts)

    nonPayable = await NonPayable.new() 
    priceFeed = contracts.priceFeedTestnet
    usdsToken = contracts.usdsToken
    sortedTroves = contracts.sortedTroves
    troveManager = contracts.troveManager
    activePool = contracts.activePool
    stabilityPool = contracts.stabilityPool
    defaultPool = contracts.defaultPool
    borrowerOperations = contracts.borrowerOperations
    hintHelpers = contracts.hintHelpers
    troveHelper = contracts.troveHelper

    sableToken = SABLEContracts.sableToken
    sableStaking = SABLEContracts.sableStaking

    // funding PriceFeed contract
    await web3.eth.sendTransaction({from: funder, to: priceFeed.address, value: 1000000000})
  })

  it('stake(): reverts if amount is zero', async () => {
    // vaultAddress transfers SABLE to staker A
    await sableToken.transfer(A, dec(100, 18), {from: vaultAddress})

    // console.log(`A sable bal: ${await sableToken.balanceOf(A)}`)

    // A makes stake
    await sableToken.approve(sableStaking.address, dec(100, 18), {from: A})
    await assertRevert(sableStaking.stake(0, {from: A}), "SABLEStaking: Amount must be non-zero")
  })

  it("BNB fee per SABLE staked increases when a redemption fee is triggered and totalStakes > 0", async () => {
    await openTrove({ extraUSDSAmount: toBN(dec(10000, 18)), ICR: toBN(dec(10, 18)), extraParams: { from: whale } })
    await openTrove({ extraUSDSAmount: toBN(dec(20000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: A } })
    await openTrove({ extraUSDSAmount: toBN(dec(30000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: B } })
    await openTrove({ extraUSDSAmount: toBN(dec(40000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: C } })

    // FF time 14 days to pass bootstrap phase
    await th.fastForwardTime(timeValues.SECONDS_IN_ONE_DAY * 14, web3.currentProvider)

    // vaultAddress transfers SABLE to staker A
    await sableToken.transfer(A, dec(100, 18), {from: vaultAddress, gasPrice: GAS_PRICE})

    // console.log(`A sable bal: ${await sableToken.balanceOf(A)}`)

    // A makes stake
    await sableToken.approve(sableStaking.address, dec(100, 18), {from: A})
    await sableStaking.stake(dec(100, 18), {from: A})

    // Check BNB fee per unit staked is zero
    const F_BNB_Before = await sableStaking.F_BNB()
    assert.equal(F_BNB_Before, '0')

    const B_BalBeforeREdemption = await usdsToken.balanceOf(B)
    // B redeems
    const redemptionTx = await th.redeemCollateralAndGetTxObject(B, contracts, dec(100, 18), GAS_PRICE)
    
    const B_BalAfterRedemption = await usdsToken.balanceOf(B)
    assert.isTrue(B_BalAfterRedemption.lt(B_BalBeforeREdemption))

    // check BNB fee emitted in event is non-zero
    const emittedBNBFee = toBN((await th.getEmittedRedemptionValues(redemptionTx))[3])
    assert.isTrue(emittedBNBFee.gt(toBN('0')))

    // Check BNB fee per unit staked has increased by correct amount
    const F_BNB_After = await sableStaking.F_BNB()

    // Expect fee per unit staked = fee/100, since there is 100 USDS totalStaked
    const expected_F_BNB_After = emittedBNBFee.div(toBN('100')) 

    assert.isTrue(expected_F_BNB_After.eq(F_BNB_After))
  })

  it("BNB fee per SABLE staked doesn't change when a redemption fee is triggered and totalStakes == 0", async () => {
    await openTrove({ extraUSDSAmount: toBN(dec(10000, 18)), ICR: toBN(dec(10, 18)), extraParams: { from: whale } })
    await openTrove({ extraUSDSAmount: toBN(dec(20000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: A } })
    await openTrove({ extraUSDSAmount: toBN(dec(30000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: B } })
    await openTrove({ extraUSDSAmount: toBN(dec(40000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: C } })
    await openTrove({ extraUSDSAmount: toBN(dec(50000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: D } })

    // FF time 14 days to pass bootstrap phase
    await th.fastForwardTime(timeValues.SECONDS_IN_ONE_DAY * 14, web3.currentProvider)

    // vaultAddress transfers SABLE to staker A
    await sableToken.transfer(A, dec(100, 18), {from: vaultAddress, gasPrice: GAS_PRICE})

    // Check BNB fee per unit staked is zero
    const F_BNB_Before = await sableStaking.F_BNB()
    assert.equal(F_BNB_Before, '0')

    const B_BalBeforeREdemption = await usdsToken.balanceOf(B)
    // B redeems
    const redemptionTx = await th.redeemCollateralAndGetTxObject(B, contracts, dec(100, 18), GAS_PRICE)
    
    const B_BalAfterRedemption = await usdsToken.balanceOf(B)
    assert.isTrue(B_BalAfterRedemption.lt(B_BalBeforeREdemption))

    // check BNB fee emitted in event is non-zero
    const emittedBNBFee = toBN((await th.getEmittedRedemptionValues(redemptionTx))[3])
    assert.isTrue(emittedBNBFee.gt(toBN('0')))

    // Check BNB fee per unit staked has not increased 
    const F_BNB_After = await sableStaking.F_BNB()
    assert.equal(F_BNB_After, '0')
  })

  it("USDS fee per SABLE staked increases when a redemption fee is triggered and totalStakes > 0", async () => {
    await openTrove({ extraUSDSAmount: toBN(dec(10000, 18)), ICR: toBN(dec(10, 18)), extraParams: { from: whale } })
    await openTrove({ extraUSDSAmount: toBN(dec(20000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: A } })
    await openTrove({ extraUSDSAmount: toBN(dec(30000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: B } })
    await openTrove({ extraUSDSAmount: toBN(dec(40000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: C } })
    await openTrove({ extraUSDSAmount: toBN(dec(50000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: D } })

    // FF time 14 days to pass bootstrap phase
    await th.fastForwardTime(timeValues.SECONDS_IN_ONE_DAY * 14, web3.currentProvider)

    // vaultAddress transfers SABLE to staker A
    await sableToken.transfer(A, dec(100, 18), {from: vaultAddress})

    // A makes stake
    await sableToken.approve(sableStaking.address, dec(100, 18), {from: A})
    await sableStaking.stake(dec(100, 18), {from: A})

    // Check USDS fee per unit staked is zero
    const F_USDS_Before = await sableStaking.F_BNB()
    assert.equal(F_USDS_Before, '0')

    const B_BalBeforeREdemption = await usdsToken.balanceOf(B)
    // B redeems
    const redemptionTx = await th.redeemCollateralAndGetTxObject(B, contracts, dec(100, 18), gasPrice= GAS_PRICE)
    
    const B_BalAfterRedemption = await usdsToken.balanceOf(B)
    assert.isTrue(B_BalAfterRedemption.lt(B_BalBeforeREdemption))

    // Check base rate is now non-zero
    const baseRate = await troveManager.baseRate()
    assert.isTrue(baseRate.gt(toBN('0')))

    // D draws debt
    const tx = await borrowerOperations.withdrawUSDS(th._100pct, dec(27, 18), D, D, DEFAULT_PRICE_FEED_DATA, {from: D})
    
    // Check USDS fee value in event is non-zero
    const emittedUSDSFee = toBN(th.getUSDSFeeFromUSDSBorrowingEvent(tx))
    assert.isTrue(emittedUSDSFee.gt(toBN('0')))
    
    // Check USDS fee per unit staked has increased by correct amount
    const F_USDS_After = await sableStaking.F_USDS()

    // Expect fee per unit staked = fee/100, since there is 100 USDS totalStaked
    const expected_F_USDS_After = emittedUSDSFee.div(toBN('100')) 

    assert.isTrue(expected_F_USDS_After.eq(F_USDS_After))
  })

  it("USDS fee per SABLE staked doesn't change when a redemption fee is triggered and totalStakes == 0", async () => {
    await openTrove({ extraUSDSAmount: toBN(dec(10000, 18)), ICR: toBN(dec(10, 18)), extraParams: { from: whale } })
    await openTrove({ extraUSDSAmount: toBN(dec(20000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: A } })
    await openTrove({ extraUSDSAmount: toBN(dec(30000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: B } })
    await openTrove({ extraUSDSAmount: toBN(dec(40000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: C } })
    await openTrove({ extraUSDSAmount: toBN(dec(50000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: D } })

    // FF time 14 days to pass bootstrap phase
    await th.fastForwardTime(timeValues.SECONDS_IN_ONE_DAY * 14, web3.currentProvider)

    // vaultAddress transfers SABLE to staker A
    await sableToken.transfer(A, dec(100, 18), {from: vaultAddress})

    // Check USDS fee per unit staked is zero
    const F_USDS_Before = await sableStaking.F_BNB()
    assert.equal(F_USDS_Before, '0')

    const B_BalBeforeREdemption = await usdsToken.balanceOf(B)
    // B redeems
    const redemptionTx = await th.redeemCollateralAndGetTxObject(B, contracts, dec(100, 18), gasPrice = GAS_PRICE)
    
    const B_BalAfterRedemption = await usdsToken.balanceOf(B)
    assert.isTrue(B_BalAfterRedemption.lt(B_BalBeforeREdemption))

    // Check base rate is now non-zero
    const baseRate = await troveManager.baseRate()
    assert.isTrue(baseRate.gt(toBN('0')))

    // D draws debt
    const tx = await borrowerOperations.withdrawUSDS(th._100pct, dec(27, 18), D, D, DEFAULT_PRICE_FEED_DATA, {from: D})
    
    // Check USDS fee value in event is non-zero
    const emittedUSDSFee = toBN(th.getUSDSFeeFromUSDSBorrowingEvent(tx))
    assert.isTrue(emittedUSDSFee.gt(toBN('0')))
    
    // Check USDS fee per unit staked did not increase, is still zero
    const F_USDS_After = await sableStaking.F_USDS()
    assert.equal(F_USDS_After, '0')
  })

  it("SABLE Staking: A single staker earns all BNB and SABLE fees that occur", async () => {
    await openTrove({ extraUSDSAmount: toBN(dec(10000, 18)), ICR: toBN(dec(10, 18)), extraParams: { from: whale } })
    await openTrove({ extraUSDSAmount: toBN(dec(20000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: A } })
    await openTrove({ extraUSDSAmount: toBN(dec(30000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: B } })
    await openTrove({ extraUSDSAmount: toBN(dec(40000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: C } })
    await openTrove({ extraUSDSAmount: toBN(dec(50000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: D } })

    // FF time 14 days to pass bootstrap phase
    await th.fastForwardTime(timeValues.SECONDS_IN_ONE_DAY * 14, web3.currentProvider)

    // vaultAddress transfers SABLE to staker A
    await sableToken.transfer(A, dec(100, 18), {from: vaultAddress})

    // A makes stake
    await sableToken.approve(sableStaking.address, dec(100, 18), {from: A})
    await sableStaking.stake(dec(100, 18), {from: A})

    const B_BalBeforeREdemption = await usdsToken.balanceOf(B)
    // B redeems
    const redemptionTx_1 = await th.redeemCollateralAndGetTxObject(B, contracts, dec(100, 18), gasPrice = GAS_PRICE)
    
    const B_BalAfterRedemption = await usdsToken.balanceOf(B)
    assert.isTrue(B_BalAfterRedemption.lt(B_BalBeforeREdemption))

    // check BNB fee 1 emitted in event is non-zero
    const emittedBNBFee_1 = toBN((await th.getEmittedRedemptionValues(redemptionTx_1))[3])
    assert.isTrue(emittedBNBFee_1.gt(toBN('0')))

    const C_BalBeforeREdemption = await usdsToken.balanceOf(C)
    // C redeems
    const redemptionTx_2 = await th.redeemCollateralAndGetTxObject(C, contracts, dec(100, 18), gasPrice = GAS_PRICE)
    
    const C_BalAfterRedemption = await usdsToken.balanceOf(C)
    assert.isTrue(C_BalAfterRedemption.lt(C_BalBeforeREdemption))
 
     // check BNB fee 2 emitted in event is non-zero
     const emittedBNBFee_2 = toBN((await th.getEmittedRedemptionValues(redemptionTx_2))[3])
     assert.isTrue(emittedBNBFee_2.gt(toBN('0')))

    // D draws debt
    const borrowingTx_1 = await borrowerOperations.withdrawUSDS(th._100pct, dec(104, 18), D, D, DEFAULT_PRICE_FEED_DATA, {from: D})
    
    // Check USDS fee value in event is non-zero
    const emittedUSDSFee_1 = toBN(th.getUSDSFeeFromUSDSBorrowingEvent(borrowingTx_1))
    assert.isTrue(emittedUSDSFee_1.gt(toBN('0')))

    // B draws debt
    const borrowingTx_2 = await borrowerOperations.withdrawUSDS(th._100pct, dec(17, 18), B, B, DEFAULT_PRICE_FEED_DATA, {from: B})
    
    // Check USDS fee value in event is non-zero
    const emittedUSDSFee_2 = toBN(th.getUSDSFeeFromUSDSBorrowingEvent(borrowingTx_2))
    assert.isTrue(emittedUSDSFee_2.gt(toBN('0')))

    const expectedTotalBNBGain = emittedBNBFee_1.add(emittedBNBFee_2)
    const expectedTotalUSDSGain = emittedUSDSFee_1.add(emittedUSDSFee_2)

    const A_BNBBalance_Before = toBN(await web3.eth.getBalance(A))
    const A_USDSBalance_Before = toBN(await usdsToken.balanceOf(A))

    // A un-stakes
    const GAS_Used = th.gasUsed(await sableStaking.unstake(dec(100, 18), {from: A, gasPrice: GAS_PRICE }))

    const A_BNBBalance_After = toBN(await web3.eth.getBalance(A))
    const A_USDSBalance_After = toBN(await usdsToken.balanceOf(A))


    const A_BNBGain = A_BNBBalance_After.sub(A_BNBBalance_Before).add(toBN(GAS_Used * GAS_PRICE))
    const A_USDSGain = A_USDSBalance_After.sub(A_USDSBalance_Before)

    assert.isAtMost(th.getDifference(expectedTotalBNBGain, A_BNBGain), 1000)
    assert.isAtMost(th.getDifference(expectedTotalUSDSGain, A_USDSGain), 1000)
  })

  it("stake(): Top-up sends out all accumulated BNB and USDS gains to the staker", async () => { 
    await openTrove({ extraUSDSAmount: toBN(dec(10000, 18)), ICR: toBN(dec(10, 18)), extraParams: { from: whale } })
    await openTrove({ extraUSDSAmount: toBN(dec(20000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: A } })
    await openTrove({ extraUSDSAmount: toBN(dec(30000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: B } })
    await openTrove({ extraUSDSAmount: toBN(dec(40000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: C } })
    await openTrove({ extraUSDSAmount: toBN(dec(50000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: D } })

    // FF time 14 days to pass bootstrap phase
    await th.fastForwardTime(timeValues.SECONDS_IN_ONE_DAY * 14, web3.currentProvider)

    // vaultAddress transfers SABLE to staker A
    await sableToken.transfer(A, dec(100, 18), {from: vaultAddress})

    // A makes stake
    await sableToken.approve(sableStaking.address, dec(100, 18), {from: A})
    await sableStaking.stake(dec(50, 18), {from: A})

    const B_BalBeforeREdemption = await usdsToken.balanceOf(B)
    // B redeems
    const redemptionTx_1 = await th.redeemCollateralAndGetTxObject(B, contracts, dec(100, 18), gasPrice = GAS_PRICE)
    
    const B_BalAfterRedemption = await usdsToken.balanceOf(B)
    assert.isTrue(B_BalAfterRedemption.lt(B_BalBeforeREdemption))

    // check BNB fee 1 emitted in event is non-zero
    const emittedBNBFee_1 = toBN((await th.getEmittedRedemptionValues(redemptionTx_1))[3])
    assert.isTrue(emittedBNBFee_1.gt(toBN('0')))

    const C_BalBeforeREdemption = await usdsToken.balanceOf(C)
    // C redeems
    const redemptionTx_2 = await th.redeemCollateralAndGetTxObject(C, contracts, dec(100, 18), gasPrice = GAS_PRICE)
    
    const C_BalAfterRedemption = await usdsToken.balanceOf(C)
    assert.isTrue(C_BalAfterRedemption.lt(C_BalBeforeREdemption))
 
     // check BNB fee 2 emitted in event is non-zero
     const emittedBNBFee_2 = toBN((await th.getEmittedRedemptionValues(redemptionTx_2))[3])
     assert.isTrue(emittedBNBFee_2.gt(toBN('0')))

    // D draws debt
    const borrowingTx_1 = await borrowerOperations.withdrawUSDS(th._100pct, dec(104, 18), D, D, DEFAULT_PRICE_FEED_DATA, {from: D})
    
    // Check USDS fee value in event is non-zero
    const emittedUSDSFee_1 = toBN(th.getUSDSFeeFromUSDSBorrowingEvent(borrowingTx_1))
    assert.isTrue(emittedUSDSFee_1.gt(toBN('0')))

    // B draws debt
    const borrowingTx_2 = await borrowerOperations.withdrawUSDS(th._100pct, dec(17, 18), B, B, DEFAULT_PRICE_FEED_DATA, {from: B})
    
    // Check USDS fee value in event is non-zero
    const emittedUSDSFee_2 = toBN(th.getUSDSFeeFromUSDSBorrowingEvent(borrowingTx_2))
    assert.isTrue(emittedUSDSFee_2.gt(toBN('0')))

    const expectedTotalBNBGain = emittedBNBFee_1.add(emittedBNBFee_2)
    const expectedTotalUSDSGain = emittedUSDSFee_1.add(emittedUSDSFee_2)

    const A_BNBBalance_Before = toBN(await web3.eth.getBalance(A))
    const A_USDSBalance_Before = toBN(await usdsToken.balanceOf(A))

    // A tops up
    const GAS_Used = th.gasUsed(await sableStaking.stake(dec(50, 18), {from: A, gasPrice: GAS_PRICE }))

    const A_BNBBalance_After = toBN(await web3.eth.getBalance(A))
    const A_USDSBalance_After = toBN(await usdsToken.balanceOf(A))

    const A_BNBGain = A_BNBBalance_After.sub(A_BNBBalance_Before).add(toBN(GAS_Used * GAS_PRICE))
    const A_USDSGain = A_USDSBalance_After.sub(A_USDSBalance_Before)

    assert.isAtMost(th.getDifference(expectedTotalBNBGain, A_BNBGain), 1000)
    assert.isAtMost(th.getDifference(expectedTotalUSDSGain, A_USDSGain), 1000)
  })

  it("getPendingBNBGain(): Returns the staker's correct pending BNB gain", async () => { 
    await openTrove({ extraUSDSAmount: toBN(dec(10000, 18)), ICR: toBN(dec(10, 18)), extraParams: { from: whale } })
    await openTrove({ extraUSDSAmount: toBN(dec(20000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: A } })
    await openTrove({ extraUSDSAmount: toBN(dec(30000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: B } })
    await openTrove({ extraUSDSAmount: toBN(dec(40000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: C } })
    await openTrove({ extraUSDSAmount: toBN(dec(50000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: D } })

    // FF time 14 days to pass bootstrap phase
    await th.fastForwardTime(timeValues.SECONDS_IN_ONE_DAY * 14, web3.currentProvider)

    // vaultAddress transfers SABLE to staker A
    await sableToken.transfer(A, dec(100, 18), {from: vaultAddress})

    // A makes stake
    await sableToken.approve(sableStaking.address, dec(100, 18), {from: A})
    await sableStaking.stake(dec(50, 18), {from: A})

    const B_BalBeforeREdemption = await usdsToken.balanceOf(B)
    // B redeems
    const redemptionTx_1 = await th.redeemCollateralAndGetTxObject(B, contracts, dec(100, 18), gasPrice = GAS_PRICE)
    
    const B_BalAfterRedemption = await usdsToken.balanceOf(B)
    assert.isTrue(B_BalAfterRedemption.lt(B_BalBeforeREdemption))

    // check BNB fee 1 emitted in event is non-zero
    const emittedBNBFee_1 = toBN((await th.getEmittedRedemptionValues(redemptionTx_1))[3])
    assert.isTrue(emittedBNBFee_1.gt(toBN('0')))

    const C_BalBeforeREdemption = await usdsToken.balanceOf(C)
    // C redeems
    const redemptionTx_2 = await th.redeemCollateralAndGetTxObject(C, contracts, dec(100, 18), gasPrice = GAS_PRICE)
    
    const C_BalAfterRedemption = await usdsToken.balanceOf(C)
    assert.isTrue(C_BalAfterRedemption.lt(C_BalBeforeREdemption))
 
     // check BNB fee 2 emitted in event is non-zero
     const emittedBNBFee_2 = toBN((await th.getEmittedRedemptionValues(redemptionTx_2))[3])
     assert.isTrue(emittedBNBFee_2.gt(toBN('0')))

    const expectedTotalBNBGain = emittedBNBFee_1.add(emittedBNBFee_2)

    const A_BNBGain = await sableStaking.getPendingBNBGain(A)

    assert.isAtMost(th.getDifference(expectedTotalBNBGain, A_BNBGain), 1000)
  })

  it("getPendingUSDSGain(): Returns the staker's correct pending USDS gain", async () => { 
    await openTrove({ extraUSDSAmount: toBN(dec(10000, 18)), ICR: toBN(dec(10, 18)), extraParams: { from: whale } })
    await openTrove({ extraUSDSAmount: toBN(dec(20000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: A } })
    await openTrove({ extraUSDSAmount: toBN(dec(30000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: B } })
    await openTrove({ extraUSDSAmount: toBN(dec(40000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: C } })
    await openTrove({ extraUSDSAmount: toBN(dec(50000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: D } })

    // FF time 14 days to pass bootstrap phase
    await th.fastForwardTime(timeValues.SECONDS_IN_ONE_DAY * 14, web3.currentProvider)

    // vaultAddress transfers SABLE to staker A
    await sableToken.transfer(A, dec(100, 18), {from: vaultAddress})

    // A makes stake
    await sableToken.approve(sableStaking.address, dec(100, 18), {from: A})
    await sableStaking.stake(dec(50, 18), {from: A})

    const B_BalBeforeREdemption = await usdsToken.balanceOf(B)
    // B redeems
    const redemptionTx_1 = await th.redeemCollateralAndGetTxObject(B, contracts, dec(100, 18), gasPrice = GAS_PRICE)
    
    const B_BalAfterRedemption = await usdsToken.balanceOf(B)
    assert.isTrue(B_BalAfterRedemption.lt(B_BalBeforeREdemption))

    // check BNB fee 1 emitted in event is non-zero
    const emittedBNBFee_1 = toBN((await th.getEmittedRedemptionValues(redemptionTx_1))[3])
    assert.isTrue(emittedBNBFee_1.gt(toBN('0')))

    const C_BalBeforeREdemption = await usdsToken.balanceOf(C)
    // C redeems
    const redemptionTx_2 = await th.redeemCollateralAndGetTxObject(C, contracts, dec(100, 18), gasPrice = GAS_PRICE)
    
    const C_BalAfterRedemption = await usdsToken.balanceOf(C)
    assert.isTrue(C_BalAfterRedemption.lt(C_BalBeforeREdemption))
 
     // check BNB fee 2 emitted in event is non-zero
     const emittedBNBFee_2 = toBN((await th.getEmittedRedemptionValues(redemptionTx_2))[3])
     assert.isTrue(emittedBNBFee_2.gt(toBN('0')))

    // D draws debt
    const borrowingTx_1 = await borrowerOperations.withdrawUSDS(th._100pct, dec(104, 18), D, D, DEFAULT_PRICE_FEED_DATA, {from: D})
    
    // Check USDS fee value in event is non-zero
    const emittedUSDSFee_1 = toBN(th.getUSDSFeeFromUSDSBorrowingEvent(borrowingTx_1))
    assert.isTrue(emittedUSDSFee_1.gt(toBN('0')))

    // B draws debt
    const borrowingTx_2 = await borrowerOperations.withdrawUSDS(th._100pct, dec(17, 18), B, B, DEFAULT_PRICE_FEED_DATA, {from: B})
    
    // Check USDS fee value in event is non-zero
    const emittedUSDSFee_2 = toBN(th.getUSDSFeeFromUSDSBorrowingEvent(borrowingTx_2))
    assert.isTrue(emittedUSDSFee_2.gt(toBN('0')))

    const expectedTotalUSDSGain = emittedUSDSFee_1.add(emittedUSDSFee_2)
    const A_USDSGain = await sableStaking.getPendingUSDSGain(A)

    assert.isAtMost(th.getDifference(expectedTotalUSDSGain, A_USDSGain), 1000)
  })

  // - multi depositors, several rewards
  it("SABLE Staking: Multiple stakers earn the correct share of all BNB and SABLE fees, based on their stake size", async () => {
    await openTrove({ extraUSDSAmount: toBN(dec(10000, 18)), ICR: toBN(dec(10, 18)), extraParams: { from: whale } })
    await openTrove({ extraUSDSAmount: toBN(dec(20000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: A } })
    await openTrove({ extraUSDSAmount: toBN(dec(30000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: B } })
    await openTrove({ extraUSDSAmount: toBN(dec(40000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: C } })
    await openTrove({ extraUSDSAmount: toBN(dec(50000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: D } })
    await openTrove({ extraUSDSAmount: toBN(dec(40000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: E } })
    await openTrove({ extraUSDSAmount: toBN(dec(50000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: F } })
    await openTrove({ extraUSDSAmount: toBN(dec(50000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: G } })

    // FF time 14 days to pass bootstrap phase
    await th.fastForwardTime(timeValues.SECONDS_IN_ONE_DAY * 14, web3.currentProvider)

    // vaultAddress transfers SABLE to staker A, B, C
    await sableToken.transfer(A, dec(100, 18), {from: vaultAddress})
    await sableToken.transfer(B, dec(200, 18), {from: vaultAddress})
    await sableToken.transfer(C, dec(300, 18), {from: vaultAddress})

    // A, B, C make stake
    await sableToken.approve(sableStaking.address, dec(100, 18), {from: A})
    await sableToken.approve(sableStaking.address, dec(200, 18), {from: B})
    await sableToken.approve(sableStaking.address, dec(300, 18), {from: C})
    await sableStaking.stake(dec(100, 18), {from: A})
    await sableStaking.stake(dec(200, 18), {from: B})
    await sableStaking.stake(dec(300, 18), {from: C})

    // Confirm staking contract holds 600 SABLE
    // console.log(`sable staking SABLE bal: ${await sableToken.balanceOf(sableStaking.address)}`)
    assert.equal(await sableToken.balanceOf(sableStaking.address), dec(600, 18))
    assert.equal(await sableStaking.totalSABLEStaked(), dec(600, 18))

    // F redeems
    const redemptionTx_1 = await th.redeemCollateralAndGetTxObject(F, contracts, dec(45, 18), gasPrice = GAS_PRICE)
    const emittedBNBFee_1 = toBN((await th.getEmittedRedemptionValues(redemptionTx_1))[3])
    assert.isTrue(emittedBNBFee_1.gt(toBN('0')))

     // G redeems
     const redemptionTx_2 = await th.redeemCollateralAndGetTxObject(G, contracts, dec(197, 18), gasPrice = GAS_PRICE)
     const emittedBNBFee_2 = toBN((await th.getEmittedRedemptionValues(redemptionTx_2))[3])
     assert.isTrue(emittedBNBFee_2.gt(toBN('0')))

    // F draws debt
    const borrowingTx_1 = await borrowerOperations.withdrawUSDS(th._100pct, dec(104, 18), F, F, DEFAULT_PRICE_FEED_DATA, {from: F})
    const emittedUSDSFee_1 = toBN(th.getUSDSFeeFromUSDSBorrowingEvent(borrowingTx_1))
    assert.isTrue(emittedUSDSFee_1.gt(toBN('0')))

    // G draws debt
    const borrowingTx_2 = await borrowerOperations.withdrawUSDS(th._100pct, dec(17, 18), G, G, DEFAULT_PRICE_FEED_DATA, {from: G})
    const emittedUSDSFee_2 = toBN(th.getUSDSFeeFromUSDSBorrowingEvent(borrowingTx_2))
    assert.isTrue(emittedUSDSFee_2.gt(toBN('0')))

    // D obtains SABLE from owner and makes a stake
    await sableToken.transfer(D, dec(50, 18), {from: vaultAddress})
    await sableToken.approve(sableStaking.address, dec(50, 18), {from: D})
    await sableStaking.stake(dec(50, 18), {from: D})

    // Confirm staking contract holds 650 SABLE
    assert.equal(await sableToken.balanceOf(sableStaking.address), dec(650, 18))
    assert.equal(await sableStaking.totalSABLEStaked(), dec(650, 18))

     // G redeems
     const redemptionTx_3 = await th.redeemCollateralAndGetTxObject(C, contracts, dec(197, 18), gasPrice = GAS_PRICE)
     const emittedBNBFee_3 = toBN((await th.getEmittedRedemptionValues(redemptionTx_3))[3])
     assert.isTrue(emittedBNBFee_3.gt(toBN('0')))

     // G draws debt
    const borrowingTx_3 = await borrowerOperations.withdrawUSDS(th._100pct, dec(17, 18), G, G, DEFAULT_PRICE_FEED_DATA, {from: G})
    const emittedUSDSFee_3 = toBN(th.getUSDSFeeFromUSDSBorrowingEvent(borrowingTx_3))
    assert.isTrue(emittedUSDSFee_3.gt(toBN('0')))
     
    /*  
    Expected rewards:

    A_BNB: (100* BNBFee_1)/600 + (100* BNBFee_2)/600 + (100*BNB_Fee_3)/650
    B_BNB: (200* BNBFee_1)/600 + (200* BNBFee_2)/600 + (200*BNB_Fee_3)/650
    C_BNB: (300* BNBFee_1)/600 + (300* BNBFee_2)/600 + (300*BNB_Fee_3)/650
    D_BNB:                                             (100*BNB_Fee_3)/650

    A_USDS: (100*USDSFee_1 )/600 + (100* USDSFee_2)/600 + (100*USDSFee_3)/650
    B_USDS: (200* USDSFee_1)/600 + (200* USDSFee_2)/600 + (200*USDSFee_3)/650
    C_USDS: (300* USDSFee_1)/600 + (300* USDSFee_2)/600 + (300*USDSFee_3)/650
    D_USDS:                                               (100*USDSFee_3)/650
    */

    // Expected BNB gains
    const expectedBNBGain_A = toBN('100').mul(emittedBNBFee_1).div( toBN('600'))
                            .add(toBN('100').mul(emittedBNBFee_2).div( toBN('600')))
                            .add(toBN('100').mul(emittedBNBFee_3).div( toBN('650')))

    const expectedBNBGain_B = toBN('200').mul(emittedBNBFee_1).div( toBN('600'))
                            .add(toBN('200').mul(emittedBNBFee_2).div( toBN('600')))
                            .add(toBN('200').mul(emittedBNBFee_3).div( toBN('650')))

    const expectedBNBGain_C = toBN('300').mul(emittedBNBFee_1).div( toBN('600'))
                            .add(toBN('300').mul(emittedBNBFee_2).div( toBN('600')))
                            .add(toBN('300').mul(emittedBNBFee_3).div( toBN('650')))

    const expectedBNBGain_D = toBN('50').mul(emittedBNBFee_3).div( toBN('650'))

    // Expected USDS gains:
    const expectedUSDSGain_A = toBN('100').mul(emittedUSDSFee_1).div( toBN('600'))
                            .add(toBN('100').mul(emittedUSDSFee_2).div( toBN('600')))
                            .add(toBN('100').mul(emittedUSDSFee_3).div( toBN('650')))

    const expectedUSDSGain_B = toBN('200').mul(emittedUSDSFee_1).div( toBN('600'))
                            .add(toBN('200').mul(emittedUSDSFee_2).div( toBN('600')))
                            .add(toBN('200').mul(emittedUSDSFee_3).div( toBN('650')))

    const expectedUSDSGain_C = toBN('300').mul(emittedUSDSFee_1).div( toBN('600'))
                            .add(toBN('300').mul(emittedUSDSFee_2).div( toBN('600')))
                            .add(toBN('300').mul(emittedUSDSFee_3).div( toBN('650')))
    
    const expectedUSDSGain_D = toBN('50').mul(emittedUSDSFee_3).div( toBN('650'))


    const A_BNBBalance_Before = toBN(await web3.eth.getBalance(A))
    const A_USDSBalance_Before = toBN(await usdsToken.balanceOf(A))
    const B_BNBBalance_Before = toBN(await web3.eth.getBalance(B))
    const B_USDSBalance_Before = toBN(await usdsToken.balanceOf(B))
    const C_BNBBalance_Before = toBN(await web3.eth.getBalance(C))
    const C_USDSBalance_Before = toBN(await usdsToken.balanceOf(C))
    const D_BNBBalance_Before = toBN(await web3.eth.getBalance(D))
    const D_USDSBalance_Before = toBN(await usdsToken.balanceOf(D))

    // A-D un-stake
    const A_GAS_Used = th.gasUsed(await sableStaking.unstake(dec(100, 18), {from: A, gasPrice: GAS_PRICE }))
    const B_GAS_Used = th.gasUsed(await sableStaking.unstake(dec(200, 18), {from: B, gasPrice: GAS_PRICE }))
    const C_GAS_Used = th.gasUsed(await sableStaking.unstake(dec(400, 18), {from: C, gasPrice: GAS_PRICE }))
    const D_GAS_Used = th.gasUsed(await sableStaking.unstake(dec(50, 18), {from: D, gasPrice: GAS_PRICE }))

    // Confirm all depositors could withdraw

    //Confirm pool Size is now 0
    assert.equal((await sableToken.balanceOf(sableStaking.address)), '0')
    assert.equal((await sableStaking.totalSABLEStaked()), '0')

    // Get A-D BNB and USDS balances
    const A_BNBBalance_After = toBN(await web3.eth.getBalance(A))
    const A_USDSBalance_After = toBN(await usdsToken.balanceOf(A))
    const B_BNBBalance_After = toBN(await web3.eth.getBalance(B))
    const B_USDSBalance_After = toBN(await usdsToken.balanceOf(B))
    const C_BNBBalance_After = toBN(await web3.eth.getBalance(C))
    const C_USDSBalance_After = toBN(await usdsToken.balanceOf(C))
    const D_BNBBalance_After = toBN(await web3.eth.getBalance(D))
    const D_USDSBalance_After = toBN(await usdsToken.balanceOf(D))

    // Get BNB and USDS gains
    const A_BNBGain = A_BNBBalance_After.sub(A_BNBBalance_Before).add(toBN(A_GAS_Used * GAS_PRICE))
    const A_USDSGain = A_USDSBalance_After.sub(A_USDSBalance_Before)
    const B_BNBGain = B_BNBBalance_After.sub(B_BNBBalance_Before).add(toBN(B_GAS_Used * GAS_PRICE))
    const B_USDSGain = B_USDSBalance_After.sub(B_USDSBalance_Before)
    const C_BNBGain = C_BNBBalance_After.sub(C_BNBBalance_Before).add(toBN(C_GAS_Used * GAS_PRICE))
    const C_USDSGain = C_USDSBalance_After.sub(C_USDSBalance_Before)
    const D_BNBGain = D_BNBBalance_After.sub(D_BNBBalance_Before).add(toBN(D_GAS_Used * GAS_PRICE))
    const D_USDSGain = D_USDSBalance_After.sub(D_USDSBalance_Before)

    // Check gains match expected amounts
    assert.isAtMost(th.getDifference(expectedBNBGain_A, A_BNBGain), 1000)
    assert.isAtMost(th.getDifference(expectedUSDSGain_A, A_USDSGain), 1000)
    assert.isAtMost(th.getDifference(expectedBNBGain_B, B_BNBGain), 1000)
    assert.isAtMost(th.getDifference(expectedUSDSGain_B, B_USDSGain), 1000)
    assert.isAtMost(th.getDifference(expectedBNBGain_C, C_BNBGain), 1000)
    assert.isAtMost(th.getDifference(expectedUSDSGain_C, C_USDSGain), 1000)
    assert.isAtMost(th.getDifference(expectedBNBGain_D, D_BNBGain), 1000)
    assert.isAtMost(th.getDifference(expectedUSDSGain_D, D_USDSGain), 1000)
  })
 
  it("unstake(): reverts if caller has BNB gains and can't receive BNB",  async () => {
    await openTrove({ extraUSDSAmount: toBN(dec(20000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: whale } })  
    await openTrove({ extraUSDSAmount: toBN(dec(20000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: A } })
    await openTrove({ extraUSDSAmount: toBN(dec(30000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: B } })
    await openTrove({ extraUSDSAmount: toBN(dec(40000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: C } })
    await openTrove({ extraUSDSAmount: toBN(dec(50000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: D } })

    await th.fastForwardTime(timeValues.SECONDS_IN_ONE_YEAR, web3.currentProvider)

    // vaultAddress transfers SABLE to staker A and the non-payable proxy
    await sableToken.transfer(A, dec(100, 18), {from: vaultAddress})
    await sableToken.transfer(nonPayable.address, dec(100, 18), {from: vaultAddress})

    //  A makes stake
    const A_stakeTx = await sableStaking.stake(dec(100, 18), {from: A})
    assert.isTrue(A_stakeTx.receipt.status)

    //  A tells proxy to make a stake
    const proxystakeTxData = await th.getTransactionData('stake(uint256)', ['0x56bc75e2d63100000'])  // proxy stakes 100 SABLE
    await nonPayable.forward(sableStaking.address, proxystakeTxData, {from: A})


    // B makes a redemption, creating BNB gain for proxy
    const redemptionTx_1 = await th.redeemCollateralAndGetTxObject(B, contracts, dec(45, 18), gasPrice = GAS_PRICE)
    
    const proxy_BNBGain = await sableStaking.getPendingBNBGain(nonPayable.address)
    assert.isTrue(proxy_BNBGain.gt(toBN('0')))

    // Expect this tx to revert: stake() tries to send nonPayable proxy's accumulated BNB gain (albeit 0),
    //  A tells proxy to unstake
    const proxyUnStakeTxData = await th.getTransactionData('unstake(uint256)', ['0x56bc75e2d63100000'])  // proxy stakes 100 SABLE
    const proxyUnstakeTxPromise = nonPayable.forward(sableStaking.address, proxyUnStakeTxData, {from: A})
   
    // but nonPayable proxy can not accept BNB - therefore stake() reverts.
    await assertRevert(proxyUnstakeTxPromise)
  })

  it("receive(): reverts when it receives BNB from an address that is not the Active Pool",  async () => { 
    const ethSendTxPromise1 = web3.eth.sendTransaction({to: sableStaking.address, from: A, value: dec(1, 'ether')})
    const ethSendTxPromise2 = web3.eth.sendTransaction({to: sableStaking.address, from: owner, value: dec(1, 'ether')})

    await assertRevert(ethSendTxPromise1)
    await assertRevert(ethSendTxPromise2)
  })

  it("unstake(): reverts if user has no stake",  async () => {  
    const unstakeTxPromise1 = sableStaking.unstake(1, {from: A})
    const unstakeTxPromise2 = sableStaking.unstake(1, {from: owner})

    await assertRevert(unstakeTxPromise1)
    await assertRevert(unstakeTxPromise2)
  })

  it('Test requireCallerIsTroveManager', async () => {
    const sableStakingTester = await SABLEStakingTester.new()
    await assertRevert(sableStakingTester.requireCallerIsTroveManager(), 'SABLEStaking: caller is not TroveM')
  })
})