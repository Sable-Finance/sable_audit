const deploymentHelper = require("../utils/deploymentHelpers.js")
const { TestHelper: th, MoneyValues: mv } = require("../utils/testHelpers.js")

const GasPool = artifacts.require("./GasPool.sol")
const BorrowerOperationsTester = artifacts.require("./BorrowerOperationsTester.sol")

contract('All Liquity functions with onlyOwner modifier', async accounts => {

  const [owner, alice, bob] = accounts;

  const [bountyAddress, lpRewardsAddress, multisig] = accounts.slice(997, 1000)

  const dec = th.dec;
  
  let contracts
  let usdsToken
  let sortedTroves
  let troveManager
  let activePool
  let stabilityPool
  let defaultPool
  let borrowerOperations
  let troveHelper

  let sableStaking
  let communityIssuance
  let sableRewarder
  let sableToken 

  before(async () => {
    contracts = await deploymentHelper.deployLiquityCore()
    contracts.borrowerOperations = await BorrowerOperationsTester.new()
    contracts = await deploymentHelper.deployUSDSToken(contracts)
    const SABLEContracts = await deploymentHelper.deploySABLEContracts(bountyAddress, 1000000)

    usdsToken = contracts.usdsToken
    sortedTroves = contracts.sortedTroves
    troveManager = contracts.troveManager
    activePool = contracts.activePool
    stabilityPool = contracts.stabilityPool
    defaultPool = contracts.defaultPool
    borrowerOperations = contracts.borrowerOperations
    troveHelper = contracts.troveHelper
    timeLock = contracts.timeLock

    sableStaking = SABLEContracts.sableStaking
    communityIssuance = SABLEContracts.communityIssuance
    sableRewarder = SABLEContracts.sableRewarder
    sableToken = SABLEContracts.sableToken
  })

  const testZeroAddress = async (contract, params, method = 'setAddresses', skip = 0) => {
    await testWrongAddress(contract, params, th.ZERO_ADDRESS, method, skip, '0addr')
  }
  const testNonContractAddress = async (contract, params, method = 'setAddresses', skip = 0) => {
    await testWrongAddress(contract, params, bob, method, skip, '0code')
  }
  const testWrongAddress = async (contract, params, address, method, skip, message) => {
    for (let i = skip; i < params.length; i++) {
      const newParams = [...params]
      newParams[i] = address
      await th.assertRevert(contract[method](...newParams, { from: owner }), message)
    }
  }

  const testZeroParam = async (contract, params, method = 'setParams', skip = 0) => {
    await testWrongParam(contract, params, th.ZERO_ADDRESS, method, skip, '0addr')
  }
  const testNonContractParam = async (contract, params, method = 'setParams', skip = 0) => {
    await testWrongParam(contract, params, bob, method, skip, '0code')
  }
  const testWrongParam = async (contract, params, address, method, skip, message) => {
    for (let i = skip; i < params.length - 1; i++) {
      const newParams = [...params]
      newParams[i] = address
      await th.assertRevert(contract[method](...newParams, { from: owner }), message)
    }
  }

  const testSetAddresses = async (contract, numberOfAddresses) => {
    const dumbContract = await GasPool.new()
    const params = Array(numberOfAddresses).fill(dumbContract.address)

    // Attempt call from alice
    await th.assertRevert(contract.setAddresses(...params, { from: alice }))

    // Attempt to use zero address
    await testZeroAddress(contract, params)
    // Attempt to use non contract
    await testNonContractAddress(contract, params)

    // Owner can successfully set any address
    const txOwner = await contract.setAddresses(...params, { from: owner })
    assert.isTrue(txOwner.receipt.status)
    // fails if called twice
    await th.assertRevert(contract.setAddresses(...params, { from: owner }))
  }

  const testSableStakingSetAddresses = async (contract, numberOfAddresses) => {
    const dumbContract = await GasPool.new()
    const params = Array(numberOfAddresses).fill(dumbContract.address)

    // Attempt call from alice
    await th.assertRevert(contract.setAddresses(...params, { from: alice }))

    // Attempt to use zero address
    await testZeroAddress(contract, params)
    // Attempt to use non contract
    await testNonContractAddress(contract, params)

    // Owner can successfully set any address
    const txOwner = await contract.setAddresses(...params, { from: owner })
    console.log(txOwner.receipt.status)
    assert.isTrue(txOwner.receipt.status)
    // fails if called twice
    await contract.renounceOwnership({ from: owner })
    await th.assertRevert(contract.setAddresses(...params, { from: owner }))
  }

  const testSetParams = async (contract, numberOfAddresses) => {
    const dumbContract = await GasPool.new()
    const params = Array(numberOfAddresses).fill(dumbContract.address)

    // Attempt call from alice
    await th.assertRevert(contract.setParams(...params, { from: alice }))

    // Attempt to use zero address
    await testZeroParam(contract, params)
    // Attempt to use non contract
    await testNonContractParam(contract, params)

    // Owner can successfully set any address
    const txOwner = await contract.setParams(...params, { from: owner })
    assert.isTrue(txOwner.receipt.status)
    // fails if called twice
    await th.assertRevert(contract.setParams(...params, { from: owner }))
  }

  describe('TroveManager', async accounts => {
    it("setAddresses(): reverts when called by non-owner, with wrong addresses, or twice", async () => {
      const dumbContract = await GasPool.new()
      const TroveManagerAddressesParam = {
        borrowerOperationsAddress: dumbContract.address,
        activePoolAddress: dumbContract.address,
        defaultPoolAddress: contracts.defaultPool.address,
        stabilityPoolAddress: contracts.stabilityPool.address,
        gasPoolAddress: dumbContract.address,
        collSurplusPoolAddress: dumbContract.address,
        priceFeedAddress: dumbContract.address,
        usdsTokenAddress: dumbContract.address,
        sortedTrovesAddress: dumbContract.address,
        sableTokenAddress: dumbContract.address,
        sableStakingAddress: dumbContract.address,
        systemStateAddress: dumbContract.address,
        oracleRateCalcAddress: dumbContract.address,
        troveHelperAddress: dumbContract.address,
      }

      const TroveManagerAddressesParamZeroAddress = {
        borrowerOperationsAddress: th.ZERO_ADDRESS,
        activePoolAddress: th.ZERO_ADDRESS,
        defaultPoolAddress: th.ZERO_ADDRESS,
        stabilityPoolAddress: th.ZERO_ADDRESS,
        gasPoolAddress: th.ZERO_ADDRESS,
        collSurplusPoolAddress: th.ZERO_ADDRESS,
        priceFeedAddress: th.ZERO_ADDRESS,
        usdsTokenAddress: th.ZERO_ADDRESS,
        sortedTrovesAddress: th.ZERO_ADDRESS,
        sableTokenAddress: th.ZERO_ADDRESS,
        sableStakingAddress: th.ZERO_ADDRESS,
        systemStateAddress: th.ZERO_ADDRESS,
        oracleRateCalcAddress: th.ZERO_ADDRESS,
        troveHelperAddress: th.ZERO_ADDRESS
      }

      const TroveManagerAddressesParamNonContract = {
        borrowerOperationsAddress: bob,
        activePoolAddress: dumbContract.address,
        defaultPoolAddress: contracts.defaultPool.address,
        stabilityPoolAddress: contracts.stabilityPool.address,
        gasPoolAddress: dumbContract.address,
        collSurplusPoolAddress: dumbContract.address,
        priceFeedAddress: dumbContract.address,
        usdsTokenAddress: dumbContract.address,
        sortedTrovesAddress: dumbContract.address,
        sableTokenAddress: dumbContract.address,
        sableStakingAddress: dumbContract.address,
        systemStateAddress: dumbContract.address,
        oracleRateCalcAddress: dumbContract.address,
        troveHelperAddress: dumbContract.address
      }

      // Attempt call from alice
      await th.assertRevert(troveManager.setAddresses(TroveManagerAddressesParam, { from: alice }))

      // Attempt to use zero address
      await th.assertRevert(troveManager.setAddresses(TroveManagerAddressesParamZeroAddress, { from: owner }), "0addr")

      // Attempt to use non contract
      await th.assertRevert(troveManager.setAddresses(TroveManagerAddressesParamNonContract, { from: owner }), "0code")

      // Owner can successfully set any address
      const txOwner = await troveManager.setAddresses(TroveManagerAddressesParam, { from: owner })
      assert.isTrue(txOwner.receipt.status)
      // fails if called twice
      await th.assertRevert(troveManager.setAddresses(TroveManagerAddressesParam, { from: owner }))
    })
  })

  describe('BorrowerOperations', async accounts => {
    it("setAddresses(): reverts when called by non-owner, with wrong addresses, or twice", async () => {
      const dumbContract = await GasPool.new()
      const BorrowerOperationAddressesParam = {
        troveManagerAddress: dumbContract.address,
        activePoolAddress: dumbContract.address,
        defaultPoolAddress: dumbContract.address,
        stabilityPoolAddress: dumbContract.address,
        gasPoolAddress: dumbContract.address,
        collSurplusPoolAddress: dumbContract.address,
        priceFeedAddress: dumbContract.address,
        sortedTrovesAddress: dumbContract.address,
        usdsTokenAddress: dumbContract.address,
        sableStakingAddress: dumbContract.address,
        systemStateAddress: dumbContract.address,
        oracleRateCalcAddress: dumbContract.address
      }

      const BorrowerOperationAddressesParamZeroAddress = {
        troveManagerAddress: dumbContract.address,
        activePoolAddress: dumbContract.address,
        defaultPoolAddress: th.ZERO_ADDRESS,
        stabilityPoolAddress: dumbContract.address,
        gasPoolAddress: dumbContract.address,
        collSurplusPoolAddress: dumbContract.address,
        priceFeedAddress: dumbContract.address,
        sortedTrovesAddress: dumbContract.address,
        usdsTokenAddress: dumbContract.address,
        sableStakingAddress: dumbContract.address,
        systemStateAddress: dumbContract.address,
        oracleRateCalcAddress: dumbContract.address
      }

      const BorrowerOperationAddressesParamNonContract = {
        troveManagerAddress: dumbContract.address,
        activePoolAddress: alice,
        defaultPoolAddress: dumbContract.address,
        stabilityPoolAddress: dumbContract.address,
        gasPoolAddress: dumbContract.address,
        collSurplusPoolAddress: dumbContract.address,
        priceFeedAddress: dumbContract.address,
        sortedTrovesAddress: dumbContract.address,
        usdsTokenAddress: dumbContract.address,
        sableStakingAddress: dumbContract.address,
        systemStateAddress: dumbContract.address,
        oracleRateCalcAddress: dumbContract.address
      }

      // Attempt call from alice
      await th.assertRevert(borrowerOperations.setAddresses(BorrowerOperationAddressesParam, { from: alice }))

      // Attempt to use zero address
      await th.assertRevert(borrowerOperations.setAddresses(BorrowerOperationAddressesParamZeroAddress, { from: owner }), "0addr")

      // Attempt to use non contract
      await th.assertRevert(borrowerOperations.setAddresses(BorrowerOperationAddressesParamNonContract, { from: owner }), "0code")

      // Owner can successfully set any address
      const txOwner = await borrowerOperations.setAddresses(BorrowerOperationAddressesParam, { from: owner })
      assert.isTrue(txOwner.receipt.status)
      // fails if called twice
      await th.assertRevert(borrowerOperations.setAddresses(BorrowerOperationAddressesParam, { from: owner }))
    })
  })

  describe('DefaultPool', async accounts => {
    it("setAddresses(): reverts when called by non-owner, with wrong addresses, or twice", async () => {
      await testSetAddresses(defaultPool, 2)
    })
  })

  describe('StabilityPool', async accounts => {
    it("setAddresses(): reverts when called by non-owner, with wrong addresses, or twice", async () => {
      await testSetParams(stabilityPool, 8)
    })
  })

  describe('ActivePool', async accounts => {
    it("setAddresses(): reverts when called by non-owner, with wrong addresses, or twice", async () => {
      await testSetAddresses(activePool, 4)
    })
  })

  describe('SortedTroves', async accounts => {
    it("setParams(): reverts when called by non-owner, with wrong addresses, or twice", async () => {
      const dumbContract = await GasPool.new()
      const params = [10000001, dumbContract.address, dumbContract.address]

      // Attempt call from alice
      await th.assertRevert(sortedTroves.setParams(...params, { from: alice }))

      // Attempt to use zero address
      await testZeroAddress(sortedTroves, params, 'setParams', 1)
      // Attempt to use non contract
      await testNonContractAddress(sortedTroves, params, 'setParams', 1)

      // Owner can successfully set params
      const txOwner = await sortedTroves.setParams(...params, { from: owner })
      assert.isTrue(txOwner.receipt.status)

      // fails if called twice
      await th.assertRevert(sortedTroves.setParams(...params, { from: owner }))
    })
  })

  describe('CommunityIssuance', async accounts => {
    it("setAddresses(): reverts when called by non-owner, with wrong addresses, or twice", async () => {
      const params = [sableToken.address, stabilityPool.address, th.dec(1, 18)]
      await th.assertRevert(communityIssuance.setParams(...params, { from: alice }))

      // Attempt to use zero address
      await testZeroParam(communityIssuance, params)
      // Attempt to use non contract
      await testNonContractParam(communityIssuance, params)

      // Owner can successfully set any address
      const txOwner = await communityIssuance.setParams(...params, { from: owner })

      assert.isTrue(txOwner.receipt.status)
      // fails if called twice
      await th.assertRevert(communityIssuance.setParams(...params, { from: owner }))
    })
  })

  describe('CommunityIssuance', async accounts => {
    it("updateRewardPerSec(): reverts when called by non-owner", async () => {
      // attempt to call update as non-owner
      await th.assertRevert(communityIssuance.updateRewardPerSec(dec(1, 18), { from: alice}))
    })
  })

  describe('SableRewarder', async accounts => {
    it("setAddresses(): reverts when called by non-owner, with wrong addresses, or twice", async () => {
      const params = [sableToken.address, sableStaking.address, th.dec(1, 18)]
      await th.assertRevert(sableRewarder.setParams(...params, { from: alice }))

      // Attempt to use zero address
      await testZeroParam(sableRewarder, params)
      // Attempt to use non contract
      await testNonContractParam(sableRewarder, params)

      // Owner can successfully set any address
      const txOwner = await sableRewarder.setParams(...params, { from: owner })

      assert.isTrue(txOwner.receipt.status)
      // fails if called twice
      await th.assertRevert(sableRewarder.setParams(...params, { from: owner }))
    })
  })

  describe('SableRewarder', async accounts => {
    it("updateRewardPerSec(): reverts when called by non-owner", async () => {
      // attempt to call update as non-owner
      await th.assertRevert(sableRewarder.updateRewardPerSec(dec(1, 18), { from: alice}))
    })
  })

  describe('SableStakingV2', async accounts => {
    it("setAddresses(): reverts when called by non-owner, with wrong addresses, or twice", async () => {
      await testSableStakingSetAddresses(sableStaking, 6)
    })
  })

})