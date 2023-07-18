const deploymentHelper = require("../utils/deploymentHelpers.js")
const testHelpers = require("../utils/testHelpers.js")

const TroveManagerTester = artifacts.require("TroveManagerTester")
const SABLETokenTester = artifacts.require("SABLETokenTester")
const { Interface } = require("@ethersproject/abi");

const th = testHelpers.TestHelper

const dec = th.dec
const toBN = th.toBN
const mv = testHelpers.MoneyValues
const timeValues = testHelpers.TimeValues

const ZERO_ADDRESS = th.ZERO_ADDRESS
const assertRevert = th.assertRevert

const GAS_PRICE = 10000000

const DEFAULT_PRICE_FEED_DATA = testHelpers.DEFAULT_PRICE_FEED_DATA
const DEFAULT_ORACLE_RATE = testHelpers.DEFAULT_ORACLE_RATE

const {
  buildUserProxies,
  BorrowerOperationsProxy,
  BorrowerWrappersProxy,
  TroveManagerProxy,
  StabilityPoolProxy,
  SortedTrovesProxy,
  TokenProxy,
  SableStakingV2Proxy
} = require('../utils/proxyHelpers.js')

// TODO: fix staking (incl. commented lines)

contract('BorrowerWrappers', async accounts => {

  const [
    owner, alice, bob, carol, dennis, whale,
    A, B, C, D, E,
    defaulter_1, defaulter_2, funder
    // frontEnd_1, frontEnd_2, frontEnd_3
  ] = accounts;

  const [bountyAddress, lpRewardsAddress, multisig] = accounts.slice(997, 1000)

  let priceFeed
  let usdsToken
  let sortedTroves
  let troveManagerOriginal
  let troveManager
  let activePool
  let stabilityPool
  let defaultPool
  let collSurplusPool
  let borrowerOperations
  let borrowerWrappers
  let sableTokenOriginal
  let sableToken
  let sableStaking
  let systemState

  let mockSableLP

  let contracts

  let USDS_GAS_COMPENSATION

  const getOpenTroveUSDSAmount = async (totalDebt) => th.getOpenTroveUSDSAmount(contracts, totalDebt)
  const getActualDebtFromComposite = async (compositeDebt) => th.getActualDebtFromComposite(compositeDebt, contracts)
  const getNetBorrowingAmount = async (debtWithFee) => th.getNetBorrowingAmount(contracts, debtWithFee, DEFAULT_ORACLE_RATE)
  const openTrove = async (params) => th.openTrove(contracts, params)

  // TODO: Confirm necessity of the test cases in this script

  beforeEach(async () => {
    contracts = await deploymentHelper.deployLiquityCore()
    contracts.troveManager = await TroveManagerTester.new()
    contracts = await deploymentHelper.deployUSDSToken(contracts)
    const MINT_AMOUNT = toBN(dec(100000000, 18))
    const SABLEContracts = await deploymentHelper.deploySABLETesterContractsHardhat(bountyAddress, MINT_AMOUNT)

    
    await deploymentHelper.connectCoreContracts(contracts, SABLEContracts)
    await deploymentHelper.connectSABLEContractsToCore(SABLEContracts, contracts)

    troveManagerOriginal = contracts.troveManager
    sableTokenOriginal = SABLEContracts.sableToken

    const users = [ alice, bob, carol, dennis, whale, A, B, C, D, E, defaulter_1, defaulter_2 ]
    await deploymentHelper.deployProxyScripts(contracts, SABLEContracts, owner, users)

    priceFeed = contracts.priceFeedTestnet
    usdsToken = contracts.usdsToken
    sortedTroves = contracts.sortedTroves
    troveManager = contracts.troveManager
    activePool = contracts.activePool
    stabilityPool = contracts.stabilityPool
    defaultPool = contracts.defaultPool
    collSurplusPool = contracts.collSurplusPool
    borrowerOperations = contracts.borrowerOperations
    borrowerWrappers = contracts.borrowerWrappers
    sableStaking = SABLEContracts.sableStaking
    sableToken = SABLEContracts.sableToken
    systemState = contracts.systemState

    // USDS_GAS_COMPENSATION = await borrowerOperations.USDS_GAS_COMPENSATION()
    USDS_GAS_COMPENSATION = await systemState.getUSDSGasCompensation()

    mockSableLP = await deploymentHelper.deployMockSableLP(bountyAddress, MINT_AMOUNT);

    // setting SableStakingV2 LP token address to Sable token address to initialize staking and allow Sable token deposit
    await sableStaking.setSableLPAddress(mockSableLP.address, { from: owner });

    // funding PriceFeed contract
    await web3.eth.sendTransaction({from: funder, to: priceFeed.address, value: 1000000000})
  })

  it('proxy owner can recover BNB', async () => {
    const amount = toBN(dec(1, 18))
    const proxyAddress = borrowerWrappers.getProxyAddressFromUser(alice)

    // send some BNB to proxy
    await web3.eth.sendTransaction({ from: owner, to: proxyAddress, value: amount, gasPrice: GAS_PRICE })
    assert.equal(await web3.eth.getBalance(proxyAddress), amount.toString())

    const balanceBefore = toBN(await web3.eth.getBalance(alice))

    // recover BNB
    const gas_Used = th.gasUsed(await borrowerWrappers.transferBNB(alice, amount.toString(), { from: alice, gasPrice: GAS_PRICE }))
    
    const balanceAfter = toBN(await web3.eth.getBalance(alice))
    const expectedBalance = toBN(balanceBefore.sub(toBN(gas_Used * GAS_PRICE)))
    assert.equal(balanceAfter.sub(expectedBalance), amount.toString())
  })

  it('non proxy owner cannot recover BNB', async () => {
    const amount = toBN(dec(1, 18))
    const proxyAddress = borrowerWrappers.getProxyAddressFromUser(alice)

    // send some BNB to proxy
    await web3.eth.sendTransaction({ from: owner, to: proxyAddress, value: amount })
    assert.equal(await web3.eth.getBalance(proxyAddress), amount.toString())

    const balanceBefore = toBN(await web3.eth.getBalance(alice))

    // try to recover BNB
    const proxy = borrowerWrappers.getProxyFromUser(alice)
    const signature = 'transferBNB(address,uint256)'
    const calldata = th.getTransactionData(signature, [alice, amount])
    await assertRevert(proxy.methods["execute(address,bytes)"](borrowerWrappers.scriptAddress, calldata, { from: bob }), 'ds-auth-unauthorized')

    assert.equal(await web3.eth.getBalance(proxyAddress), amount.toString())

    const balanceAfter = toBN(await web3.eth.getBalance(alice))
    assert.equal(balanceAfter, balanceBefore.toString())
  })

  // --- claimCollateralAndOpenTrove ---

  it('claimCollateralAndOpenTrove(): reverts if nothing to claim', async () => {
    // Whale opens Trove
    await openTrove({ ICR: toBN(dec(2, 18)), extraParams: { from: whale } })

    // alice opens Trove
    const { usdsAmount, collateral } = await openTrove({ ICR: toBN(dec(15, 17)), extraParams: { from: alice } })

    const proxyAddress = borrowerWrappers.getProxyAddressFromUser(alice)
    assert.equal(await web3.eth.getBalance(proxyAddress), '0')

    // skip bootstrapping phase
    await th.fastForwardTime(timeValues.SECONDS_IN_ONE_WEEK * 2, web3.currentProvider)

    // alice claims collateral and re-opens the trove
    await assertRevert(
      borrowerWrappers.claimCollateralAndOpenTrove(th._100pct, usdsAmount, alice, alice, DEFAULT_PRICE_FEED_DATA, { from: alice }),
      'CollSurplusPool: No collateral available to claim'
    )

    // check everything remain the same
    assert.equal(await web3.eth.getBalance(proxyAddress), '0')
    th.assertIsApproximatelyEqual(await collSurplusPool.getCollateral(proxyAddress), '0')
    th.assertIsApproximatelyEqual(await usdsToken.balanceOf(proxyAddress), usdsAmount)
    assert.equal(await troveManager.getTroveStatus(proxyAddress), 1)
    th.assertIsApproximatelyEqual(await troveManager.getTroveColl(proxyAddress), collateral)
  })

  it('claimCollateralAndOpenTrove(): without sending any value', async () => {
    // alice opens Trove
    const { usdsAmount, netDebt: redeemAmount, collateral } = await openTrove({extraUSDSAmount: 0, ICR: toBN(dec(3, 18)), extraParams: { from: alice } })
    // Whale opens Trove
    await openTrove({ extraUSDSAmount: redeemAmount, ICR: toBN(dec(5, 18)), extraParams: { from: whale } })

    const proxyAddress = borrowerWrappers.getProxyAddressFromUser(alice)
    assert.equal(await web3.eth.getBalance(proxyAddress), '0')

    // skip bootstrapping phase
    await th.fastForwardTime(timeValues.SECONDS_IN_ONE_WEEK * 2, web3.currentProvider)

    // whale redeems 150 USDS
    await th.redeemCollateral(whale, contracts, redeemAmount, GAS_PRICE)
    assert.equal(await web3.eth.getBalance(proxyAddress), '0')

    // surplus: 5 - 150/200
    const price = await priceFeed.getPrice();
    const expectedSurplus = collateral.sub(redeemAmount.mul(mv._1e18BN).div(price))
    th.assertIsApproximatelyEqual(await collSurplusPool.getCollateral(proxyAddress), expectedSurplus)
    assert.equal(await troveManager.getTroveStatus(proxyAddress), 4) // closed by redemption

    // alice claims collateral and re-opens the trove
    await borrowerWrappers.claimCollateralAndOpenTrove(th._100pct, usdsAmount, alice, alice, DEFAULT_PRICE_FEED_DATA, { from: alice })

    assert.equal(await web3.eth.getBalance(proxyAddress), '0')
    th.assertIsApproximatelyEqual(await collSurplusPool.getCollateral(proxyAddress), '0')
    th.assertIsApproximatelyEqual(await usdsToken.balanceOf(proxyAddress), usdsAmount.mul(toBN(2)))
    assert.equal(await troveManager.getTroveStatus(proxyAddress), 1)
    th.assertIsApproximatelyEqual(await troveManager.getTroveColl(proxyAddress), expectedSurplus)
  })

  it('claimCollateralAndOpenTrove(): sending value in the transaction', async () => {
    // alice opens Trove
    const { usdsAmount, netDebt: redeemAmount, collateral } = await openTrove({ extraParams: { from: alice } })
    // Whale opens Trove
    await openTrove({ extraUSDSAmount: redeemAmount, ICR: toBN(dec(2, 18)), extraParams: { from: whale } })

    const proxyAddress = borrowerWrappers.getProxyAddressFromUser(alice)
    assert.equal(await web3.eth.getBalance(proxyAddress), '0')

    // skip bootstrapping phase
    await th.fastForwardTime(timeValues.SECONDS_IN_ONE_WEEK * 2, web3.currentProvider)

    // whale redeems 150 USDS
    await th.redeemCollateral(whale, contracts, redeemAmount, GAS_PRICE)
    assert.equal(await web3.eth.getBalance(proxyAddress), '0')

    // surplus: 5 - 150/200
    const price = await priceFeed.getPrice();
    const expectedSurplus = collateral.sub(redeemAmount.mul(mv._1e18BN).div(price))
    th.assertIsApproximatelyEqual(await collSurplusPool.getCollateral(proxyAddress), expectedSurplus)
    assert.equal(await troveManager.getTroveStatus(proxyAddress), 4) // closed by redemption

    // alice claims collateral and re-opens the trove
    await borrowerWrappers.claimCollateralAndOpenTrove(th._100pct, usdsAmount, alice, alice, DEFAULT_PRICE_FEED_DATA, { from: alice, value: collateral })

    assert.equal(await web3.eth.getBalance(proxyAddress), '0')
    th.assertIsApproximatelyEqual(await collSurplusPool.getCollateral(proxyAddress), '0')
    th.assertIsApproximatelyEqual(await usdsToken.balanceOf(proxyAddress), usdsAmount.mul(toBN(2)))
    assert.equal(await troveManager.getTroveStatus(proxyAddress), 1)
    th.assertIsApproximatelyEqual(await troveManager.getTroveColl(proxyAddress), expectedSurplus.add(collateral))
  })

  // --- claimSPRewardsAndRecycle ---

  it('claimSPRewardsAndRecycle(): only owner can call it', async () => {
    // Whale opens Trove
    await openTrove({ extraUSDSAmount: toBN(dec(1850, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: whale } })
    // Whale deposits 1850 USDS in StabilityPool
    await stabilityPool.provideToSP(dec(1850, 18), ZERO_ADDRESS, { from: whale })

    // alice opens trove and provides 150 USDS to StabilityPool
    await openTrove({ extraUSDSAmount: toBN(dec(150, 18)), extraParams: { from: alice } })
    await stabilityPool.provideToSP(dec(150, 18), ZERO_ADDRESS, { from: alice })

    // Defaulter Trove opened
    await openTrove({ ICR: toBN(dec(210, 16)), extraParams: { from: defaulter_1 } })

    // price drops: defaulters' Troves fall below MCR, alice and whale Trove remain active
    const price = toBN(dec(100, 18))
    await priceFeed.setPrice(price);

    // Defaulter trove closed
    const liquidationTX_1 = await troveManager.liquidate(defaulter_1, DEFAULT_PRICE_FEED_DATA, { from: owner })
    const [liquidatedDebt_1] = await th.getEmittedLiquidationValues(liquidationTX_1)

    // Bob tries to claims SP rewards in behalf of Alice
    const proxy = borrowerWrappers.getProxyFromUser(alice)
    const signature = 'claimSPRewardsAndRecycle(uint256,address,address)'
    const calldata = th.getTransactionData(signature, [th._100pct, alice, alice])
    await assertRevert(proxy.methods["execute(address,bytes)"](borrowerWrappers.scriptAddress, calldata, { from: bob }), 'ds-auth-unauthorized')
  })

  it('claimSPRewardsAndRecycle():', async () => {
    // Whale opens Trove
    const whaleDeposit = toBN(dec(2350, 18))
    await openTrove({ extraUSDSAmount: whaleDeposit, ICR: toBN(dec(4, 18)), extraParams: { from: whale } })
    // Whale deposits 1850 USDS in StabilityPool
    await stabilityPool.provideToSP(whaleDeposit, ZERO_ADDRESS, { from: whale })

    // alice opens trove and provides 150 USDS to StabilityPool
    const aliceDeposit = toBN(dec(150, 18))
    await openTrove({ extraUSDSAmount: aliceDeposit, ICR: toBN(dec(3, 18)), extraParams: { from: alice } })
    await stabilityPool.provideToSP(aliceDeposit, ZERO_ADDRESS, { from: alice })

    // Defaulter Trove opened
    const { usdsAmount, netDebt, collateral } = await openTrove({ ICR: toBN(dec(210, 16)), extraParams: { from: defaulter_1 } })

    // price drops: defaulters' Troves fall below MCR, alice and whale Trove remain active
    const price = toBN(dec(100, 18))
    await priceFeed.setPrice(price);

    // Defaulter trove closed
    const liquidationTX_1 = await troveManager.liquidate(defaulter_1, DEFAULT_PRICE_FEED_DATA, { from: owner })
    const [liquidatedDebt_1] = await th.getEmittedLiquidationValues(liquidationTX_1)

    // Alice USDSLoss is ((150/2500) * liquidatedDebt)
    const totalDeposits = whaleDeposit.add(aliceDeposit)
    const expectedUSDSLoss_A = liquidatedDebt_1.mul(aliceDeposit).div(totalDeposits)

    const expectedCompoundedUSDSDeposit_A = toBN(dec(150, 18)).sub(expectedUSDSLoss_A)
    const compoundedUSDSDeposit_A = await stabilityPool.getCompoundedUSDSDeposit(alice)
    // collateral * 150 / 2500 * 0.995
    const expectedBNBGain_A = collateral.mul(aliceDeposit).div(totalDeposits).mul(toBN(dec(995, 15))).div(mv._1e18BN)

    assert.isAtMost(th.getDifference(expectedCompoundedUSDSDeposit_A, compoundedUSDSDeposit_A), 1000)

    const ethBalanceBefore = await web3.eth.getBalance(borrowerOperations.getProxyAddressFromUser(alice))
    const troveCollBefore = await troveManager.getTroveColl(alice)
    const usdsBalanceBefore = await usdsToken.balanceOf(alice)
    const troveDebtBefore = await troveManager.getTroveDebt(alice)
    const sableBalanceBefore = await sableToken.balanceOf(alice)
    const ICRBefore = await troveManager.getCurrentICR(alice, price)
    const depositBefore = (await stabilityPool.deposits(alice))[0]
    const stakeBefore = await sableStaking.stakes(alice)

    const proportionalUSDS = expectedBNBGain_A.mul(price).div(ICRBefore)
    const borrowingRate = await troveManagerOriginal.getBorrowingRateWithDecay(DEFAULT_ORACLE_RATE)
    const netDebtChange = proportionalUSDS.mul(mv._1e18BN).div(mv._1e18BN.add(borrowingRate))

    // to force SABLE issuance
    await th.fastForwardTime(timeValues.SECONDS_IN_ONE_WEEK * 2, web3.currentProvider)

    const expectedSABLEGain_A = toBN('50373424199406504708132')

    await priceFeed.setPrice(price.mul(toBN(2)));

    // Alice claims SP rewards and puts them back in the system through the proxy
    const proxyAddress = borrowerWrappers.getProxyAddressFromUser(alice)
    tx1 = await borrowerWrappers.claimSPRewardsAndRecycle(th._100pct, alice, alice, DEFAULT_PRICE_FEED_DATA, { from: alice })
    console.log(tx1)

    const ethBalanceAfter = await web3.eth.getBalance(borrowerOperations.getProxyAddressFromUser(alice))
    const troveCollAfter = await troveManager.getTroveColl(alice)
    const usdsBalanceAfter = await usdsToken.balanceOf(alice)
    const troveDebtAfter = await troveManager.getTroveDebt(alice)
    const sableBalanceAfter = await sableToken.balanceOf(alice)
    const ICRAfter = await troveManager.getCurrentICR(alice, price)
    const depositAfter = (await stabilityPool.deposits(alice))[0]
    const stakeAfter = await sableStaking.stakes(alice)

    // check proxy balances remain the same
    assert.equal(ethBalanceAfter.toString(), ethBalanceBefore.toString())
    assert.equal(usdsBalanceAfter.toString(), usdsBalanceBefore.toString())
    assert.equal(sableBalanceAfter.toString(), sableBalanceBefore.toString())
    // check trove has increased debt by the ICR proportional amount to BNB gain
    th.assertIsApproximatelyEqual(troveDebtAfter, troveDebtBefore.add(proportionalUSDS))
    // check trove has increased collateral by the BNB gain
    th.assertIsApproximatelyEqual(troveCollAfter, troveCollBefore.add(expectedBNBGain_A))
    // check that ICR remains constant
    th.assertIsApproximatelyEqual(ICRAfter, ICRBefore)
    // check that Stability Pool deposit
    th.assertIsApproximatelyEqual(depositAfter, depositBefore.sub(expectedUSDSLoss_A).add(netDebtChange))
    // check sable balance remains the same
    th.assertIsApproximatelyEqual(sableBalanceAfter, sableBalanceBefore)

    // SABLE staking
    th.assertIsApproximatelyEqual(stakeAfter, stakeBefore.add(expectedSABLEGain_A))

    // Expect Alice has withdrawn all BNB gain
    const alice_pendingBNBGain = await stabilityPool.getDepositorBNBGain(alice)
    assert.equal(alice_pendingBNBGain, 0)
  })


  // --- claimStakingGainsAndRecycle ---

  it('claimStakingGainsAndRecycle(): only owner can call it', async () => {
    // Whale opens Trove
    await openTrove({ extraUSDSAmount: toBN(dec(1850, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: whale } })

    // alice opens trove
    await openTrove({ extraUSDSAmount: toBN(dec(150, 18)), extraParams: { from: alice } })

    // A and whale artificially receives SABLE, then stakes them
    await mockSableLP.transfer(whale, dec(1850, 18), { from: bountyAddress })
    await mockSableLP.transfer(alice, dec(150, 18), { from: bountyAddress })
    await mockSableLP.approve(sableStaking.address, dec(1850, 18), { from: whale })
    await mockSableLP.approve(sableStaking.address, dec(150, 18), { from: alice })
    await sableStaking.stake(dec(1850, 18), { from: whale });
    await sableStaking.stake(dec(150, 18), { from: alice });

    // Defaulter Trove opened
    const { usdsAmount, netDebt, totalDebt, collateral } = await openTrove({ ICR: toBN(dec(210, 16)), extraParams: { from: defaulter_1 } })

    // skip bootstrapping phase
    await th.fastForwardTime(timeValues.SECONDS_IN_ONE_WEEK * 2, web3.currentProvider)

    // whale redeems 100 USDS
    const redeemedAmount = toBN(dec(100, 18))
    await th.redeemCollateral(whale, contracts, redeemedAmount, GAS_PRICE)

    // Bob tries to claims staking gains in behalf of Alice
    const proxy = borrowerWrappers.getProxyFromUser(alice)
    const signature = 'claimStakingGainsAndRecycle(uint256,address,address,bytes[])'
    const calldata = th.getTransactionData(signature, [th._100pct, alice, alice, DEFAULT_PRICE_FEED_DATA])
    await assertRevert(proxy.methods["execute(address,bytes)"](borrowerWrappers.scriptAddress, calldata, { from: bob }), 'ds-auth-unauthorized')
  })

  it('claimStakingGainsAndRecycle(): reverts if user has no trove', async () => {
    const price = toBN(dec(200, 18))

    // Whale opens Trove
    await openTrove({ extraUSDSAmount: toBN(dec(1850, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: whale } })
    // Whale deposits 1850 USDS in StabilityPool
    await stabilityPool.provideToSP(dec(1850, 18), ZERO_ADDRESS, { from: whale })

    // alice opens trove and provides 150 USDS to StabilityPool
    //await openTrove({ extraUSDSAmount: toBN(dec(150, 18)), extraParams: { from: alice } })
    //await stabilityPool.provideToSP(dec(150, 18), ZERO_ADDRESS, { from: alice })

    // A and whale artificially receives SABLE, then stakes them
    await mockSableLP.transfer(whale, dec(1850, 18), { from: bountyAddress })
    await mockSableLP.transfer(alice, dec(150, 18), { from: bountyAddress })
    await mockSableLP.approve(sableStaking.address, dec(1850, 18), { from: whale })
    await mockSableLP.approve(sableStaking.address, dec(150, 18), { from: alice })
    await sableStaking.stake(dec(1850, 18), { from: whale });
    await sableStaking.stake(dec(150, 18), { from: alice });

    // Defaulter Trove opened
    const { usdsAmount, netDebt, totalDebt, collateral } = await openTrove({ ICR: toBN(dec(210, 16)), extraParams: { from: defaulter_1 } })
    const borrowingFee = netDebt.sub(usdsAmount)

    // Alice USDS gain is ((150/2000) * borrowingFee)
    const expectedUSDSGain_A = borrowingFee.mul(toBN(dec(150, 18))).div(toBN(dec(2000, 18)))

    // skip bootstrapping phase
    await th.fastForwardTime(timeValues.SECONDS_IN_ONE_WEEK * 2, web3.currentProvider)

    // whale redeems 100 USDS
    const redeemedAmount = toBN(dec(100, 18))
    await th.redeemCollateral(whale, contracts, redeemedAmount, GAS_PRICE)

    const ethBalanceBefore = await web3.eth.getBalance(borrowerOperations.getProxyAddressFromUser(alice))
    const troveCollBefore = await troveManager.getTroveColl(alice)
    const usdsBalanceBefore = await usdsToken.balanceOf(alice)
    const troveDebtBefore = await troveManager.getTroveDebt(alice)
    const sableBalanceBefore = await sableToken.balanceOf(alice)
    const ICRBefore = await troveManager.getCurrentICR(alice, price)
    const depositBefore = (await stabilityPool.deposits(alice))[0]
    const stakeBefore = await sableStaking.stakes(alice)

    // Alice claims staking rewards and puts them back in the system through the proxy
    await assertRevert(
      borrowerWrappers.claimStakingGainsAndRecycle(th._100pct, alice, alice, DEFAULT_PRICE_FEED_DATA, { from: alice }),
      'BorrowerWrappersScript: caller must have an active trove'
    )

    const ethBalanceAfter = await web3.eth.getBalance(borrowerOperations.getProxyAddressFromUser(alice))
    const troveCollAfter = await troveManager.getTroveColl(alice)
    const usdsBalanceAfter = await usdsToken.balanceOf(alice)
    const troveDebtAfter = await troveManager.getTroveDebt(alice)
    const sableBalanceAfter = await sableToken.balanceOf(alice)
    const ICRAfter = await troveManager.getCurrentICR(alice, price)
    const depositAfter = (await stabilityPool.deposits(alice))[0]
    const stakeAfter = await sableStaking.stakes(alice)

    // check everything remains the same
    assert.equal(ethBalanceAfter.toString(), ethBalanceBefore.toString())
    assert.equal(usdsBalanceAfter.toString(), usdsBalanceBefore.toString())
    assert.equal(sableBalanceAfter.toString(), sableBalanceBefore.toString())
    th.assertIsApproximatelyEqual(troveDebtAfter, troveDebtBefore, 10000)
    th.assertIsApproximatelyEqual(troveCollAfter, troveCollBefore)
    th.assertIsApproximatelyEqual(ICRAfter, ICRBefore)
    th.assertIsApproximatelyEqual(depositAfter, depositBefore, 10000)
    th.assertIsApproximatelyEqual(sableBalanceBefore, sableBalanceAfter)
    // SABLE staking
    th.assertIsApproximatelyEqual(stakeAfter, stakeBefore)

    // Expect Alice has withdrawn all BNB gain
    const alice_pendingBNBGain = await stabilityPool.getDepositorBNBGain(alice)
    assert.equal(alice_pendingBNBGain, 0)
  })

  it('claimStakingGainsAndRecycle(): with only BNB gain', async () => {
    const price = toBN(dec(200, 18))

    // Whale opens Trove
    await openTrove({ extraUSDSAmount: toBN(dec(1850, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: whale } })

    // Defaulter Trove opened
    const { usdsAmount, netDebt, collateral } = await openTrove({ ICR: toBN(dec(210, 16)), extraParams: { from: defaulter_1 } })
    const borrowingFee = netDebt.sub(usdsAmount)

    // alice opens trove and provides 150 USDS to StabilityPool
    await openTrove({ extraUSDSAmount: toBN(dec(150, 18)), extraParams: { from: alice } })
    await stabilityPool.provideToSP(dec(150, 18), ZERO_ADDRESS, { from: alice })

    // A and whale artificially receives SABLE, then stakes them
    await mockSableLP.transfer(whale, dec(1850, 18), { from: bountyAddress })
    await mockSableLP.transfer(alice, dec(150, 18), { from: bountyAddress })
    await mockSableLP.approve(sableStaking.address, dec(1850, 18), { from: whale })
    await mockSableLP.approve(sableStaking.address, dec(150, 18), { from: alice })
    await sableStaking.stake(dec(1850, 18), { from: whale });
    await sableStaking.stake(dec(150, 18), { from: alice });

    // skip bootstrapping phase
    await th.fastForwardTime(timeValues.SECONDS_IN_ONE_WEEK * 2, web3.currentProvider)

    // whale redeems 100 USDS
    const redeemedAmount = toBN(dec(100, 18))
    await th.redeemCollateral(whale, contracts, redeemedAmount, GAS_PRICE)

    // Alice BNB gain is ((150/2000) * (redemption fee over redeemedAmount) / price)
    const redemptionFee = await troveManager.getRedemptionFeeWithDecay(redeemedAmount, DEFAULT_ORACLE_RATE)
    const expectedBNBGain_A = redemptionFee.mul(toBN(dec(150, 18))).div(toBN(dec(2000, 18))).mul(mv._1e18BN).div(price)

    const ethBalanceBefore = await web3.eth.getBalance(borrowerOperations.getProxyAddressFromUser(alice))
    const troveCollBefore = await troveManager.getTroveColl(alice)
    const usdsBalanceBefore = await usdsToken.balanceOf(alice)
    const troveDebtBefore = await troveManager.getTroveDebt(alice)
    const sableBalanceBefore = await sableToken.balanceOf(alice)
    const ICRBefore = await troveManager.getCurrentICR(alice, price)
    const depositBefore = (await stabilityPool.deposits(alice))[0]
    const stakeBefore = await sableStaking.stakes(alice)

    const proportionalUSDS = expectedBNBGain_A.mul(price).div(ICRBefore)
    const borrowingRate = await troveManagerOriginal.getBorrowingRateWithDecay(DEFAULT_ORACLE_RATE)
    const netDebtChange = proportionalUSDS.mul(toBN(dec(1, 18))).div(toBN(dec(1, 18)).add(borrowingRate))

    const expectedSABLEGain_A = toBN('839557069990108416000000')

    const proxyAddress = borrowerWrappers.getProxyAddressFromUser(alice)
    // Alice claims staking rewards and puts them back in the system through the proxy
    await borrowerWrappers.claimStakingGainsAndRecycle(th._100pct, alice, alice, DEFAULT_PRICE_FEED_DATA, { from: alice })

    // Alice new USDS gain due to her own Trove adjustment: ((150/2000) * (borrowing fee over netDebtChange))
    const newBorrowingFee = await troveManagerOriginal.getBorrowingFeeWithDecay(netDebtChange, DEFAULT_ORACLE_RATE)
    const expectedNewUSDSGain_A = newBorrowingFee.mul(toBN(dec(150, 18))).div(toBN(dec(2000, 18)))

    const ethBalanceAfter = await web3.eth.getBalance(borrowerOperations.getProxyAddressFromUser(alice))
    const troveCollAfter = await troveManager.getTroveColl(alice)
    const usdsBalanceAfter = await usdsToken.balanceOf(alice)
    const troveDebtAfter = await troveManager.getTroveDebt(alice)
    const sableBalanceAfter = await sableToken.balanceOf(alice)
    const ICRAfter = await troveManager.getCurrentICR(alice, price)
    const depositAfter = (await stabilityPool.deposits(alice))[0]
    const stakeAfter = await sableStaking.stakes(alice)

    // check proxy balances remain the same
    assert.equal(ethBalanceAfter.toString(), ethBalanceBefore.toString())
    assert.equal(sableBalanceAfter.toString(), sableBalanceBefore.toString())
    // check proxy usds balance has increased by own adjust trove reward
    th.assertIsApproximatelyEqual(usdsBalanceAfter, usdsBalanceBefore.add(expectedNewUSDSGain_A))
    // check trove has increased debt by the ICR proportional amount to BNB gain
    th.assertIsApproximatelyEqual(troveDebtAfter, troveDebtBefore.add(proportionalUSDS), 10000)
    // check trove has increased collateral by the BNB gain
    th.assertIsApproximatelyEqual(troveCollAfter, troveCollBefore.add(expectedBNBGain_A))
    // check that ICR remains constant
    th.assertIsApproximatelyEqual(ICRAfter, ICRBefore)
    // check that Stability Pool deposit
    th.assertIsApproximatelyEqual(depositAfter, depositBefore.add(netDebtChange), 10000)
    // check sable balance remains the same
    th.assertIsApproximatelyEqual(sableBalanceBefore, sableBalanceAfter)

    // SABLE staking
    th.assertIsApproximatelyEqual(stakeAfter, stakeBefore.add(expectedSABLEGain_A))

    // Expect Alice has withdrawn all BNB gain
    const alice_pendingBNBGain = await stabilityPool.getDepositorBNBGain(alice)
    assert.equal(alice_pendingBNBGain, 0)
  })

  it('claimStakingGainsAndRecycle(): with only USDS gain', async () => {
    const price = toBN(dec(200, 18))

    // Whale opens Trove
    await openTrove({ extraUSDSAmount: toBN(dec(1850, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: whale } })

    // alice opens trove and provides 150 USDS to StabilityPool
    await openTrove({ extraUSDSAmount: toBN(dec(150, 18)), extraParams: { from: alice } })
    await stabilityPool.provideToSP(dec(150, 18), ZERO_ADDRESS, { from: alice })

    // A and whale artificially receives SABLE, then stakes them
    await mockSableLP.transfer(whale, dec(1850, 18), { from: bountyAddress })
    await mockSableLP.transfer(alice, dec(150, 18), { from: bountyAddress })
    await mockSableLP.approve(sableStaking.address, dec(1850, 18), { from: whale })
    await mockSableLP.approve(sableStaking.address, dec(150, 18), { from: alice })
    await sableStaking.stake(dec(1850, 18), { from: whale });
    await sableStaking.stake(dec(150, 18), { from: alice });

    // Defaulter Trove opened
    const { usdsAmount, netDebt, collateral } = await openTrove({ ICR: toBN(dec(210, 16)), extraParams: { from: defaulter_1 } })
    const borrowingFee = netDebt.sub(usdsAmount)

    // Alice USDS gain is ((150/2000) * borrowingFee)
    const expectedUSDSGain_A = borrowingFee.mul(toBN(dec(150, 18))).div(toBN(dec(2000, 18)))

    const ethBalanceBefore = await web3.eth.getBalance(borrowerOperations.getProxyAddressFromUser(alice))
    const troveCollBefore = await troveManager.getTroveColl(alice)
    const usdsBalanceBefore = await usdsToken.balanceOf(alice)
    const troveDebtBefore = await troveManager.getTroveDebt(alice)
    const sableBalanceBefore = await sableToken.balanceOf(alice)
    const ICRBefore = await troveManager.getCurrentICR(alice, price)
    const depositBefore = (await stabilityPool.deposits(alice))[0]
    const stakeBefore = await sableStaking.stakes(alice)

    const borrowingRate = await troveManagerOriginal.getBorrowingRateWithDecay(DEFAULT_ORACLE_RATE)

    // Alice claims staking rewards and puts them back in the system through the proxy
    await borrowerWrappers.claimStakingGainsAndRecycle(th._100pct, alice, alice, DEFAULT_PRICE_FEED_DATA, { from: alice })

    const ethBalanceAfter = await web3.eth.getBalance(borrowerOperations.getProxyAddressFromUser(alice))
    const troveCollAfter = await troveManager.getTroveColl(alice)
    const usdsBalanceAfter = await usdsToken.balanceOf(alice)
    const troveDebtAfter = await troveManager.getTroveDebt(alice)
    const sableBalanceAfter = await sableToken.balanceOf(alice)
    const ICRAfter = await troveManager.getCurrentICR(alice, price)
    const depositAfter = (await stabilityPool.deposits(alice))[0]
    const stakeAfter = await sableStaking.stakes(alice)

    // check proxy balances remain the same
    assert.equal(ethBalanceAfter.toString(), ethBalanceBefore.toString())
    assert.equal(sableBalanceAfter.toString(), sableBalanceBefore.toString())
    // check proxy usds balance has increased by own adjust trove reward
    th.assertIsApproximatelyEqual(usdsBalanceAfter, usdsBalanceBefore)
    // check trove has increased debt by the ICR proportional amount to BNB gain
    th.assertIsApproximatelyEqual(troveDebtAfter, troveDebtBefore, 10000)
    // check trove has increased collateral by the BNB gain
    th.assertIsApproximatelyEqual(troveCollAfter, troveCollBefore)
    // check that ICR remains constant
    th.assertIsApproximatelyEqual(ICRAfter, ICRBefore)
    // check that Stability Pool deposit
    th.assertIsApproximatelyEqual(depositAfter, depositBefore.add(expectedUSDSGain_A), 10000)
    // check sable balance remains the same
    th.assertIsApproximatelyEqual(sableBalanceBefore, sableBalanceAfter)

    // Expect Alice has withdrawn all BNB gain
    const alice_pendingBNBGain = await stabilityPool.getDepositorBNBGain(alice)
    assert.equal(alice_pendingBNBGain, 0)
  })

  it('claimStakingGainsAndRecycle(): with both BNB and USDS gains', async () => {
    const price = toBN(dec(200, 18))

    // Whale opens Trove
    await openTrove({ extraUSDSAmount: toBN(dec(1850, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: whale } })

    // alice opens trove and provides 150 USDS to StabilityPool
    await openTrove({ extraUSDSAmount: toBN(dec(150, 18)), extraParams: { from: alice } })
    await stabilityPool.provideToSP(dec(150, 18), ZERO_ADDRESS, { from: alice })

    // A and whale artificially receives SABLE, then stakes them
    await mockSableLP.transfer(whale, dec(1850, 18), { from: bountyAddress })
    await mockSableLP.transfer(alice, dec(150, 18), { from: bountyAddress })
    await mockSableLP.approve(sableStaking.address, dec(1850, 18), { from: whale })
    await mockSableLP.approve(sableStaking.address, dec(150, 18), { from: alice })
    await sableStaking.stake(dec(1850, 18), { from: whale });
    await sableStaking.stake(dec(150, 18), { from: alice });

    // Defaulter Trove opened
    const { usdsAmount, netDebt, collateral } = await openTrove({ ICR: toBN(dec(210, 16)), extraParams: { from: defaulter_1 } })
    const borrowingFee = netDebt.sub(usdsAmount)

    // Alice USDS gain is ((150/2000) * borrowingFee)
    const expectedUSDSGain_A = borrowingFee.mul(toBN(dec(150, 18))).div(toBN(dec(2000, 18)))

    // skip bootstrapping phase
    await th.fastForwardTime(timeValues.SECONDS_IN_ONE_WEEK * 2, web3.currentProvider)

    // whale redeems 100 USDS
    const redeemedAmount = toBN(dec(100, 18))
    await th.redeemCollateral(whale, contracts, redeemedAmount, GAS_PRICE)

    // Alice BNB gain is ((150/2000) * (redemption fee over redeemedAmount) / price)
    const redemptionFee = await troveManager.getRedemptionFeeWithDecay(redeemedAmount, DEFAULT_ORACLE_RATE)
    const expectedBNBGain_A = redemptionFee.mul(toBN(dec(150, 18))).div(toBN(dec(2000, 18))).mul(mv._1e18BN).div(price)

    const ethBalanceBefore = await web3.eth.getBalance(borrowerOperations.getProxyAddressFromUser(alice))
    const troveCollBefore = await troveManager.getTroveColl(alice)
    const usdsBalanceBefore = await usdsToken.balanceOf(alice)
    const troveDebtBefore = await troveManager.getTroveDebt(alice)
    const sableBalanceBefore = await sableToken.balanceOf(alice)
    const ICRBefore = await troveManager.getCurrentICR(alice, price)
    const depositBefore = (await stabilityPool.deposits(alice))[0]
    const stakeBefore = await sableStaking.stakes(alice)

    const proportionalUSDS = expectedBNBGain_A.mul(price).div(ICRBefore)
    const borrowingRate = await troveManagerOriginal.getBorrowingRateWithDecay(DEFAULT_ORACLE_RATE)
    const netDebtChange = proportionalUSDS.mul(toBN(dec(1, 18))).div(toBN(dec(1, 18)).add(borrowingRate))
    const expectedTotalUSDS = expectedUSDSGain_A.add(netDebtChange)

    const expectedSABLEGain_A = toBN('839557069990108416000000')

    // Alice claims staking rewards and puts them back in the system through the proxy
    await borrowerWrappers.claimStakingGainsAndRecycle(th._100pct, alice, alice, DEFAULT_PRICE_FEED_DATA, { from: alice })

    // Alice new USDS gain due to her own Trove adjustment: ((150/2000) * (borrowing fee over netDebtChange))
    const newBorrowingFee = await troveManagerOriginal.getBorrowingFeeWithDecay(netDebtChange, DEFAULT_ORACLE_RATE)
    const expectedNewUSDSGain_A = newBorrowingFee.mul(toBN(dec(150, 18))).div(toBN(dec(2000, 18)))

    const ethBalanceAfter = await web3.eth.getBalance(borrowerOperations.getProxyAddressFromUser(alice))
    const troveCollAfter = await troveManager.getTroveColl(alice)
    const usdsBalanceAfter = await usdsToken.balanceOf(alice)
    const troveDebtAfter = await troveManager.getTroveDebt(alice)
    const sableBalanceAfter = await sableToken.balanceOf(alice)
    const ICRAfter = await troveManager.getCurrentICR(alice, price)
    const depositAfter = (await stabilityPool.deposits(alice))[0]
    const stakeAfter = await sableStaking.stakes(alice)

    // check proxy balances remain the same
    assert.equal(ethBalanceAfter.toString(), ethBalanceBefore.toString())
    assert.equal(sableBalanceAfter.toString(), sableBalanceBefore.toString())
    // check proxy usds balance has increased by own adjust trove reward
    th.assertIsApproximatelyEqual(usdsBalanceAfter, usdsBalanceBefore.add(expectedNewUSDSGain_A))
    // check trove has increased debt by the ICR proportional amount to BNB gain
    th.assertIsApproximatelyEqual(troveDebtAfter, troveDebtBefore.add(proportionalUSDS), 10000)
    // check trove has increased collateral by the BNB gain
    th.assertIsApproximatelyEqual(troveCollAfter, troveCollBefore.add(expectedBNBGain_A))
    // check that ICR remains constant
    th.assertIsApproximatelyEqual(ICRAfter, ICRBefore)
    // check that Stability Pool deposit
    th.assertIsApproximatelyEqual(depositAfter, depositBefore.add(expectedTotalUSDS), 10000)
    // check sable balance remains the same
    th.assertIsApproximatelyEqual(sableBalanceBefore, sableBalanceAfter)

    // SABLE staking
    th.assertIsApproximatelyEqual(stakeAfter, stakeBefore.add(expectedSABLEGain_A))

    // Expect Alice has withdrawn all BNB gain
    const alice_pendingBNBGain = await stabilityPool.getDepositorBNBGain(alice)
    assert.equal(alice_pendingBNBGain, 0)
  })

})