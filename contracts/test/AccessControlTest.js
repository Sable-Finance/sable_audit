const deploymentHelper = require("../utils/deploymentHelpers.js")
const testHelpers = require("../utils/testHelpers.js")
const TroveManagerTester = artifacts.require("TroveManagerTester")

const th = testHelpers.TestHelper
const timeValues = testHelpers.TimeValues
const DEFAULT_ORACLE_RATE = testHelpers.DEFAULT_PRICE_FEED_DATA
const DEFAULT_PRICE_FEED_DATA = testHelpers.DEFAULT_PRICE_FEED_DATA

const dec = th.dec
const toBN = th.toBN
const assertRevert = th.assertRevert

/* The majority of access control tests are contained in this file. However, tests for restrictions 
on the Liquity admin address's capabilities during the first year are found in:

test/launchSequenceTest/DuringLockupPeriodTest.js */

contract('Access Control: Liquity functions with the caller restricted to Liquity contract(s)', async accounts => {

  const [owner, alice, bob, carol] = accounts;
  const funder = accounts[1001];
  const [bountyAddress, lpRewardsAddress, multisig] = accounts.slice(997, 1000)

  let coreContracts

  let priceFeed
  let lusdToken
  let sortedTroves
  let troveManager
  let nameRegistry
  let activePool
  let stabilityPool
  let defaultPool
  let functionCaller
  let borrowerOperations

  let lqtyStaking
  let lqtyToken
  let communityIssuance
  let troveHelper

  const MINT_AMOUNT = toBN(dec(1000000, 18))

  before(async () => {
    coreContracts = await deploymentHelper.deployLiquityCore()
    coreContracts.troveManager = await TroveManagerTester.new()
    coreContracts = await deploymentHelper.deployLUSDTokenTester(coreContracts)
    const LQTYContracts = await deploymentHelper.deployLQTYTesterContractsHardhat(bountyAddress, MINT_AMOUNT)
    
    priceFeed = coreContracts.priceFeedTestnet
    lusdToken = coreContracts.lusdToken
    sortedTroves = coreContracts.sortedTroves
    troveManager = coreContracts.troveManager
    nameRegistry = coreContracts.nameRegistry
    activePool = coreContracts.activePool
    stabilityPool = coreContracts.stabilityPool
    defaultPool = coreContracts.defaultPool
    functionCaller = coreContracts.functionCaller
    borrowerOperations = coreContracts.borrowerOperations
    troveHelper = coreContracts.troveHelper

    lqtyStaking = LQTYContracts.lqtyStaking
    lqtyToken = LQTYContracts.lqtyToken
    communityIssuance = LQTYContracts.communityIssuance

    await deploymentHelper.connectCoreContracts(coreContracts, LQTYContracts)
    await deploymentHelper.connectLQTYContractsToCore(LQTYContracts, coreContracts)

    // funding PriceFeed contract
    await web3.eth.sendTransaction({from: funder, to: priceFeed.address, value: 1000000000})

    for (account of accounts.slice(0, 10)) {
      await th.openTrove(coreContracts, { extraLUSDAmount: toBN(dec(20000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: account } })
    }

    // Check CI has been properly funded
    const bal = await lqtyToken.balanceOf(bountyAddress)
    assert.equal(Number(bal), Number(MINT_AMOUNT))
  })

  describe('BorrowerOperations', async accounts => { 
    it("moveETHGainToTrove(): reverts when called by an account that is not StabilityPool", async () => {
      // Attempt call from alice
      try {
        const tx1= await borrowerOperations.moveETHGainToTrove(bob, bob, bob, DEFAULT_PRICE_FEED_DATA, { from: bob })
      } catch (err) {
        assert.include(err.message, "revert")
        // assert.include(err.message, "BorrowerOps: Caller is not Stability Pool")
      }
    })
  })

  describe('TroveManager', async accounts => {
    // applyPendingRewards
    it("applyPendingRewards(): reverts when called by an account that is not BorrowerOperations", async () => {
      // Attempt call from alice
      try {
        const txAlice = await troveManager.applyPendingRewards(bob, { from: alice })
        
      } catch (err) {
         assert.include(err.message, "revert")
        // assert.include(err.message, "Caller is not the BorrowerOperations contract")
      }
    })

    // updateRewardSnapshots
    it("updateRewardSnapshots(): reverts when called by an account that is not BorrowerOperations", async () => {
      // Attempt call from alice
      try {
        const txAlice = await troveManager.updateTroveRewardSnapshots(bob, { from: alice })
        
      } catch (err) {
        assert.include(err.message, "revert" )
        // assert.include(err.message, "Caller is not the BorrowerOperations contract")
      }
    })

    // removeStake
    it("removeStake(): reverts when called by an account that is not BorrowerOperations", async () => {
      // Attempt call from alice
      try {
        const txAlice = await troveManager.removeStake(bob, { from: alice })
        
      } catch (err) {
        assert.include(err.message, "revert")
        // assert.include(err.message, "Caller is not the BorrowerOperations contract")
      }
    })

    // updateStakeAndTotalStakes
    it("updateStakeAndTotalStakes(): reverts when called by an account that is not BorrowerOperations", async () => {
      // Attempt call from alice
      try {
        const txAlice = await troveManager.updateStakeAndTotalStakes(bob, { from: alice })
        
      } catch (err) {
        assert.include(err.message, "revert")
        // assert.include(err.message, "Caller is not the BorrowerOperations contract")
      }
    })

    // closeTrove
    it("closeTrove(): reverts when called by an account that is not BorrowerOperations", async () => {
      // Attempt call from alice
      try {
        const txAlice = await troveManager.closeTrove(bob, { from: alice })
        
      } catch (err) {
        assert.include(err.message, "revert")
        // assert.include(err.message, "Caller is not the BorrowerOperations contract")
      }
    })

    // addTroveOwnerToArray
    it("addTroveOwnerToArray(): reverts when called by an account that is not BorrowerOperations", async () => {
      // Attempt call from alice
      try {
        const txAlice = await troveManager.addTroveOwnerToArray(bob, { from: alice })
        
      } catch (err) {
         assert.include(err.message, "revert")
        // assert.include(err.message, "Caller is not the BorrowerOperations contract")
      }
    })

    // setTroveStatus
    it("setTroveStatus(): reverts when called by an account that is not BorrowerOperations", async () => {
      // Attempt call from alice
      try {
        const txAlice = await troveManager.setTroveStatus(bob, 1, { from: alice })
        
      } catch (err) {
         assert.include(err.message, "revert")
        // assert.include(err.message, "Caller is not the BorrowerOperations contract")
      }
    })

    // increaseTroveColl
    it("increaseTroveColl(): reverts when called by an account that is not BorrowerOperations", async () => {
      // Attempt call from alice
      try {
        const txAlice = await troveManager.increaseTroveColl(bob, 100, { from: alice })
        
      } catch (err) {
         assert.include(err.message, "revert")
        // assert.include(err.message, "Caller is not the BorrowerOperations contract")
      }
    })

    // decreaseTroveColl
    it("decreaseTroveColl(): reverts when called by an account that is not BorrowerOperations", async () => {
      // Attempt call from alice
      try {
        const txAlice = await troveManager.decreaseTroveColl(bob, 100, { from: alice })
        
      } catch (err) {
         assert.include(err.message, "revert")
        // assert.include(err.message, "Caller is not the BorrowerOperations contract")
      }
    })

    // increaseTroveDebt
    it("increaseTroveDebt(): reverts when called by an account that is not BorrowerOperations", async () => {
      // Attempt call from alice
      try {
        const txAlice = await troveManager.increaseTroveDebt(bob, 100, { from: alice })
        
      } catch (err) {
         assert.include(err.message, "revert")
        // assert.include(err.message, "Caller is not the BorrowerOperations contract")
      }
    })

    // decreaseTroveDebt
    it("decreaseTroveDebt(): reverts when called by an account that is not BorrowerOperations", async () => {
      // Attempt call from alice
      try {
        const txAlice = await troveManager.decreaseTroveDebt(bob, 100, { from: alice })
        
      } catch (err) {
         assert.include(err.message, "revert")
        // assert.include(err.message, "Caller is not the BorrowerOperations contract")
      }
    })
  })

  describe('TroveHelper', async accounts => {
    it("getCappedOffsetVals(): reverts when called by an account that is not TroveManager", async () => {
      try {
        const tx = await troveHelper.getCappedOffsetVals(0, 0, 0, { from: alice })
      } catch (err) {
        assert.include(err.message, "revert")
      }
    })

    it("isValidFirstRedemptionHint(): reverts when called by an account that is not TroveManager", async () => {
      try {
        const tx = await troveHelper.isValidFirstRedemptionHint(sortedTroves.address, alice, 0, { from: alice })
      } catch (err) {
        assert.include(err.message, "revert")
      }
    })

    it("requireValidMaxFeePercentage(): reverts when called by an account that is not TroveManager", async () => {
      try {
        const tx = await troveHelper.requireValidMaxFeePercentage(100000, { from: alice })
      } catch (err) {
        assert.include(err.message, "revert")
      }
    })

    it("requireAfterBootstrapPeriod(): reverts when called by an account that is not TroveManager", async () => {
      try {
        const tx = await troveHelper.requireAfterBootstrapPeriod({ from: alice })
      } catch (err) {
        assert.include(err.message, "revert")
      }
    })

    it("requireLUSDBalanceCoversRedemption(): reverts when called by an account that is not TroveManager", async () => {
      try {
        const tx = await troveHelper.requireLUSDBalanceCoversRedemption(lusdToken.address, alice, 1000, { from: alice })
      } catch (err) {
        assert.include(err.message, "revert")
      }
    })

    it("requireMoreThanOneTroveInSystem(): reverts when called by an account that is not TroveManager", async () => {
      try {
        const tx = await troveHelper.requireMoreThanOneTroveInSystem(1000, { from: alice })
      } catch (err) {
        assert.include(err.message, "revert")
      }
    })

    it("requireAmountGreaterThanZero(): reverts when called by an account that is not TroveManager", async () => {
      try {
        const tx = await troveHelper.requireAmountGreaterThanZero(1000, { from: alice })
      } catch (err) {
        assert.include(err.message, "revert")
      }
    })

    it("requireTCRoverMCR(): reverts when called by an account that is not TroveManager", async () => {
      try {
        const tx = await troveHelper.requireTCRoverMCR(1000000, { from: alice })
      } catch (err) {
        assert.include(err.message, "revert")
      }
    })

    it("checkPotentialRecoveryMode(): reverts when called by an account that is not TroveManager", async () => {
      try {
        const tx = await troveHelper.checkPotentialRecoveryMode(1000000, 100000, 100000, { from: alice })
      } catch (err) {
        assert.include(err.message, "revert")
      }
    })

  })

  describe('ActivePool', async accounts => {
    // sendETH
    it("sendETH(): reverts when called by an account that is not BO nor TroveM nor SP", async () => {
      // Attempt call from alice
      try {
        const txAlice = await activePool.sendETH(alice, 100, { from: alice })
        
      } catch (err) {
        assert.include(err.message, "revert")
        assert.include(err.message, "Caller is neither BorrowerOperations nor TroveManager nor StabilityPool")
      }
    })

    // increaseLUSD	
    it("increaseLUSDDebt(): reverts when called by an account that is not BO nor TroveM", async () => {
      // Attempt call from alice
      try {
        const txAlice = await activePool.increaseLUSDDebt(100, { from: alice })
        
      } catch (err) {
        assert.include(err.message, "revert")
        assert.include(err.message, "Caller is neither BorrowerOperations nor TroveManager")
      }
    })

    // decreaseLUSD
    it("decreaseLUSDDebt(): reverts when called by an account that is not BO nor TroveM nor SP", async () => {
      // Attempt call from alice
      try {
        const txAlice = await activePool.decreaseLUSDDebt(100, { from: alice })
        
      } catch (err) {
        assert.include(err.message, "revert")
        assert.include(err.message, "Caller is neither BorrowerOperations nor TroveManager nor StabilityPool")
      }
    })

    // fallback (payment)	
    it("fallback(): reverts when called by an account that is not Borrower Operations nor Default Pool", async () => {
      // Attempt call from alice
      try {
        const txAlice = await web3.eth.sendTransaction({ from: alice, to: activePool.address, value: 100 })
        
      } catch (err) {
        assert.include(err.message, "revert")
        assert.include(err.message, "ActivePool: Caller is neither BO nor Default Pool")
      }
    })
  })

  describe('DefaultPool', async accounts => {
    // sendETHToActivePool
    it("sendETHToActivePool(): reverts when called by an account that is not TroveManager", async () => {
      // Attempt call from alice
      try {
        const txAlice = await defaultPool.sendETHToActivePool(100, { from: alice })
        
      } catch (err) {
        assert.include(err.message, "revert")
        assert.include(err.message, "Caller is not the TroveManager")
      }
    })

    // increaseLUSD	
    it("increaseLUSDDebt(): reverts when called by an account that is not TroveManager", async () => {
      // Attempt call from alice
      try {
        const txAlice = await defaultPool.increaseLUSDDebt(100, { from: alice })
        
      } catch (err) {
        assert.include(err.message, "revert")
        assert.include(err.message, "Caller is not the TroveManager")
      }
    })

    // decreaseLUSD	
    it("decreaseLUSD(): reverts when called by an account that is not TroveManager", async () => {
      // Attempt call from alice
      try {
        const txAlice = await defaultPool.decreaseLUSDDebt(100, { from: alice })
        
      } catch (err) {
        assert.include(err.message, "revert")
        assert.include(err.message, "Caller is not the TroveManager")
      }
    })

    // fallback (payment)	
    it("fallback(): reverts when called by an account that is not the Active Pool", async () => {
      // Attempt call from alice
      try {
        const txAlice = await web3.eth.sendTransaction({ from: alice, to: defaultPool.address, value: 100 })
        
      } catch (err) {
        assert.include(err.message, "revert")
        assert.include(err.message, "DefaultPool: Caller is not the ActivePool")
      }
    })
  })

  describe('StabilityPool', async accounts => {
    // --- onlyTroveManager --- 

    // offset
    it("offset(): reverts when called by an account that is not TroveManager", async () => {
      // Attempt call from alice
      try {
        txAlice = await stabilityPool.offset(100, 10, { from: alice })
        assert.fail(txAlice)
      } catch (err) {
        assert.include(err.message, "revert")
        assert.include(err.message, "Caller is not TroveManager")
      }
    })

    // --- onlyActivePool ---

    // fallback (payment)	
    it("fallback(): reverts when called by an account that is not the Active Pool", async () => {
      // Attempt call from alice
      try {
        const txAlice = await web3.eth.sendTransaction({ from: alice, to: stabilityPool.address, value: 100 })
        
      } catch (err) {
        assert.include(err.message, "revert")
        assert.include(err.message, "StabilityPool: Caller is not ActivePool")
      }
    })
  })

  describe('LUSDToken', async accounts => {

    //    mint
    it("mint(): reverts when called by an account that is not BorrowerOperations", async () => {
      // Attempt call from alice
      const txAlice = lusdToken.mint(bob, 100, { from: alice })
      await th.assertRevert(txAlice, "Caller is not BorrowerOperations")
    })

    // burn
    it("burn(): reverts when called by an account that is not BO nor TroveM nor SP", async () => {
      // Attempt call from alice
      try {
        const txAlice = await lusdToken.burn(bob, 100, { from: alice })
        
      } catch (err) {
        assert.include(err.message, "revert")
        // assert.include(err.message, "Caller is neither BorrowerOperations nor TroveManager nor StabilityPool")
      }
    })

    // sendToPool
    it("sendToPool(): reverts when called by an account that is not StabilityPool", async () => {
      // Attempt call from alice
      try {
        const txAlice = await lusdToken.sendToPool(bob, activePool.address, 100, { from: alice })
        
      } catch (err) {
        assert.include(err.message, "revert")
        assert.include(err.message, "Caller is not the StabilityPool")
      }
    })

    // returnFromPool
    it("returnFromPool(): reverts when called by an account that is not TroveManager nor StabilityPool", async () => {
      // Attempt call from alice
      try {
        const txAlice = await lusdToken.returnFromPool(activePool.address, bob, 100, { from: alice })
        
      } catch (err) {
        assert.include(err.message, "revert")
        // assert.include(err.message, "Caller is neither TroveManager nor StabilityPool")
      }
    })
  })

  describe('SortedTroves', async accounts => {
    // --- onlyBorrowerOperations ---
    //     insert

    const SortedTrovesInsertParam = {
      id: bob,
      newNICR: '150000000000000000000',
      prevId: bob,
      nextId: bob
    }

    it("insert(): reverts when called by an account that is not BorrowerOps or TroveM", async () => {
      // Attempt call from alice
      try {
        const txAlice = await sortedTroves.insert(SortedTrovesInsertParam, { from: alice })
        
      } catch (err) {
        assert.include(err.message, "revert")
        assert.include(err.message, " Caller is neither BO nor TroveM")
      }
    })

    // --- onlyTroveManager ---
    // remove
    it("remove(): reverts when called by an account that is not TroveManager", async () => {
      // Attempt call from alice
      try {
        const txAlice = await sortedTroves.remove(bob, { from: alice })
        
      } catch (err) {
        assert.include(err.message, "revert")
        assert.include(err.message, " Caller is not the TroveManager")
      }
    })

    // --- onlyTroveMorBM ---
    // reinsert
    it("reinsert(): reverts when called by an account that is neither BorrowerOps nor TroveManager", async () => {
      // Attempt call from alice
      try {
        const txAlice = await sortedTroves.reInsert(SortedTrovesInsertParam, { from: alice })
        
      } catch (err) {
        assert.include(err.message, "revert")
        assert.include(err.message, "Caller is neither BO nor TroveM")
      }
    })
  })

  describe('LQTYStaking', async accounts => {
    it("increaseF_LUSD(): reverts when caller is not TroveManager", async () => {
      try {
        const txAlice = await lqtyStaking.increaseF_LUSD(dec(1, 18), { from: alice })
        
      } catch (err) {
        assert.include(err.message, "revert")
      }
    })
  })

  describe('LQTYToken', async accounts => {
    it("sendToLQTYStaking(): reverts when caller is not the LQTYSstaking", async () => {
      // Check multisig has some LQTY
      assert.isTrue((await lqtyToken.balanceOf(bountyAddress)).gt(toBN('0')))

      // multisig tries to call it
      try {
        const tx = await lqtyToken.sendToLQTYStaking(bountyAddress, 1, { from: bountyAddress })
      } catch (err) {
        assert.include(err.message, "revert")
      }

      // Owner transfers 1 LQTY to bob
      await lqtyToken.transfer(bob, dec(1, 18), { from: bountyAddress })
      assert.equal((await lqtyToken.balanceOf(bob)), dec(1, 18))

      // Bob tries to call it
      try {
        const tx = await lqtyToken.sendToLQTYStaking(bob, dec(1, 18), { from: bob })
      } catch (err) {
        assert.include(err.message, "revert")
      }
    })
  })

  describe('CommunityIssuance', async accounts => {
    it("sendLQTY(): reverts when caller is not the StabilityPool", async () => {
      const tx1 = communityIssuance.sendLQTY(alice, dec(100, 18), {from: alice})
      const tx2 = communityIssuance.sendLQTY(bob, dec(100, 18), {from: alice})
      const tx3 = communityIssuance.sendLQTY(stabilityPool.address, dec(100, 18), {from: alice})
     
      assertRevert(tx1)
      assertRevert(tx2)
      assertRevert(tx3)
    })
  })

  
})
