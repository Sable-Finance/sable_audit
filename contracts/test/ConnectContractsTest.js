const deploymentHelper = require("../utils/deploymentHelpers.js")
const testHelpers = require("../utils/testHelpers.js")
const th = testHelpers.TestHelper
const toBN = th.toBN
const dec = th.dec

contract('Deployment script - Sets correct contract addresses dependencies after deployment', async accounts => {
  const [owner] = accounts;

  const [bountyAddress, lpRewardsAddress, multisig] = accounts.slice(997, 1000)
  
  let priceFeed
  let usdsToken
  let sortedTroves
  let troveManager
  let activePool
  let stabilityPool
  let defaultPool
  let functionCaller
  let borrowerOperations
  let sableStaking
  let sableToken
  let communityIssuance
  let troveHelper
  let systemState

  const MINT_AMOUNT = toBN(dec(1000, 18))

  before(async () => {
    const coreContracts = await deploymentHelper.deployLiquityCore()
    const SABLEContracts = await deploymentHelper.deploySABLEContracts(bountyAddress, MINT_AMOUNT)

    priceFeed = coreContracts.priceFeedTestnet
    usdsToken = coreContracts.usdsToken
    sortedTroves = coreContracts.sortedTroves
    troveManager = coreContracts.troveManager
    activePool = coreContracts.activePool
    stabilityPool = coreContracts.stabilityPool
    defaultPool = coreContracts.defaultPool
    functionCaller = coreContracts.functionCaller
    borrowerOperations = coreContracts.borrowerOperations
    systemState = coreContracts.systemState
    troveHelper = coreContracts.troveHelper

    sableStaking = SABLEContracts.sableStaking
    sableToken = SABLEContracts.sableToken
    communityIssuance = SABLEContracts.communityIssuance

    await deploymentHelper.connectCoreContracts(coreContracts, SABLEContracts)
    await deploymentHelper.connectSABLEContractsToCore(SABLEContracts, coreContracts)
  })

  it('Sets the correct PriceFeed address in TroveManager', async () => {
    const priceFeedAddress = priceFeed.address

    const recordedPriceFeedAddress = await troveManager.priceFeed()

    assert.equal(priceFeedAddress, recordedPriceFeedAddress)
  })

  it('Sets the correct USDSToken address in TroveManager', async () => {
    const usdsTokenAddress = usdsToken.address

    const recordedClvTokenAddress = await troveManager.usdsToken()

    assert.equal(usdsTokenAddress, recordedClvTokenAddress)
  })

  it('Sets the correct SortedTroves address in TroveManager', async () => {
    const sortedTrovesAddress = sortedTroves.address

    const recordedSortedTrovesAddress = await troveManager.sortedTroves()

    assert.equal(sortedTrovesAddress, recordedSortedTrovesAddress)
  })

  it('Sets the correct BorrowerOperations address in TroveManager', async () => {
    const borrowerOperationsAddress = borrowerOperations.address

    const recordedBorrowerOperationsAddress = await troveManager.borrowerOperationsAddress()

    assert.equal(borrowerOperationsAddress, recordedBorrowerOperationsAddress)
  })

  // ActivePool in TroveM
  it('Sets the correct ActivePool address in TroveManager', async () => {
    const activePoolAddress = activePool.address

    const recordedActivePoolAddresss = await troveManager.activePool()

    assert.equal(activePoolAddress, recordedActivePoolAddresss)
  })

  // DefaultPool in TroveM
  it('Sets the correct DefaultPool address in TroveManager', async () => {
    const defaultPoolAddress = defaultPool.address

    const recordedDefaultPoolAddresss = await troveManager.defaultPool()

    assert.equal(defaultPoolAddress, recordedDefaultPoolAddresss)
  })

  // StabilityPool in TroveM
  it('Sets the correct StabilityPool address in TroveManager', async () => {
    const stabilityPoolAddress = stabilityPool.address

    const recordedStabilityPoolAddresss = await troveManager.stabilityPool()

    assert.equal(stabilityPoolAddress, recordedStabilityPoolAddresss)
  })

  // SABLE Staking in TroveM
  it('Sets the correct SABLEStaking address in TroveManager', async () => {
    const sableStakingAddress = sableStaking.address

    const recordedSABLEStakingAddress = await troveManager.sableStaking()
    assert.equal(sableStakingAddress, recordedSABLEStakingAddress)
  })

  // TroveHelper in TroveM
  it('Sets the correct TroveHelper address in TroveManager', async () => {
    const troveHelperAddress = troveHelper.address

    const recordedTroveHelperAddress = await troveManager.troveHelper()
    assert.equal(troveHelperAddress, recordedTroveHelperAddress)
  })

  // TroveHelper

  it('Sets the correct TroveManager address in TroveHelper', async () => {
    const troveManagerAddress = troveManager.address

    const recordedTroveManagerAddress  = await troveHelper.troveManager()

    assert.equal(troveManagerAddress, recordedTroveManagerAddress)
  })

  it('Sets the correct SystemState address in TroveHelper', async () => {
    const systemStateAddress = systemState.address

    const recordedSystemStateAddress  = await troveHelper.systemState()

    assert.equal(systemStateAddress, recordedSystemStateAddress)
  })

  it('Sets the correct SortedTroves address in TroveHelper', async () => {
    const sortedTrovesAddress = sortedTroves.address

    const recordedSortedTrovesAddress  = await troveHelper.sortedTroves()

    assert.equal(sortedTrovesAddress, recordedSortedTrovesAddress)
  })

  it('Sets the correct SABLEToken address in TroveHelper', async () => {
    const sableTokenAddress = sableToken.address

    const recordeSABLETokenAddress  = await troveHelper.sableToken()

    assert.equal(sableTokenAddress, recordeSABLETokenAddress)
  })

  it('Sets the correct ActivePool address in TroveHelper', async () => {
    const activePoolAddress = activePool.address

    const recordeActivePoolAddress  = await troveHelper.activePool()

    assert.equal(activePoolAddress, recordeActivePoolAddress)
  })

  it('Sets the correct DefaultPool address in TroveHelper', async () => {
    const defaultPoolAddress = defaultPool.address

    const recordedDefaultPoolAddress  = await troveHelper.defaultPool()

    assert.equal(defaultPoolAddress, recordedDefaultPoolAddress)
  })

  // Active Pool

  it('Sets the correct StabilityPool address in ActivePool', async () => {
    const stabilityPoolAddress = stabilityPool.address

    const recordedStabilityPoolAddress = await activePool.stabilityPoolAddress()

    assert.equal(stabilityPoolAddress, recordedStabilityPoolAddress)
  })

  it('Sets the correct DefaultPool address in ActivePool', async () => {
    const defaultPoolAddress = defaultPool.address

    const recordedDefaultPoolAddress = await activePool.defaultPoolAddress()

    assert.equal(defaultPoolAddress, recordedDefaultPoolAddress)
  })

  it('Sets the correct BorrowerOperations address in ActivePool', async () => {
    const borrowerOperationsAddress = borrowerOperations.address

    const recordedBorrowerOperationsAddress = await activePool.borrowerOperationsAddress()

    assert.equal(borrowerOperationsAddress, recordedBorrowerOperationsAddress)
  })

  it('Sets the correct TroveManager address in ActivePool', async () => {
    const troveManagerAddress = troveManager.address

    const recordedTroveManagerAddress = await activePool.troveManagerAddress()
    assert.equal(troveManagerAddress, recordedTroveManagerAddress)
  })

  // Stability Pool

  it('Sets the correct ActivePool address in StabilityPool', async () => {
    const activePoolAddress = activePool.address

    const recordedActivePoolAddress = await stabilityPool.activePool()
    assert.equal(activePoolAddress, recordedActivePoolAddress)
  })

  it('Sets the correct BorrowerOperations address in StabilityPool', async () => {
    const borrowerOperationsAddress = borrowerOperations.address

    const recordedBorrowerOperationsAddress = await stabilityPool.borrowerOperations()

    assert.equal(borrowerOperationsAddress, recordedBorrowerOperationsAddress)
  })

  it('Sets the correct USDSToken address in StabilityPool', async () => {
    const usdsTokenAddress = usdsToken.address

    const recordedClvTokenAddress = await stabilityPool.usdsToken()

    assert.equal(usdsTokenAddress, recordedClvTokenAddress)
  })

  it('Sets the correct TroveManager address in StabilityPool', async () => {
    const troveManagerAddress = troveManager.address

    const recordedTroveManagerAddress = await stabilityPool.troveManager()
    assert.equal(troveManagerAddress, recordedTroveManagerAddress)
  })

  // Default Pool

  it('Sets the correct TroveManager address in DefaultPool', async () => {
    const troveManagerAddress = troveManager.address

    const recordedTroveManagerAddress = await defaultPool.troveManagerAddress()
    assert.equal(troveManagerAddress, recordedTroveManagerAddress)
  })

  it('Sets the correct ActivePool address in DefaultPool', async () => {
    const activePoolAddress = activePool.address

    const recordedActivePoolAddress = await defaultPool.activePoolAddress()
    assert.equal(activePoolAddress, recordedActivePoolAddress)
  })

  it('Sets the correct TroveManager address in SortedTroves', async () => {
    const borrowerOperationsAddress = borrowerOperations.address

    const recordedBorrowerOperationsAddress = await sortedTroves.borrowerOperationsAddress()
    assert.equal(borrowerOperationsAddress, recordedBorrowerOperationsAddress)
  })

  it('Sets the correct BorrowerOperations address in SortedTroves', async () => {
    const troveManagerAddress = troveManager.address

    const recordedTroveManagerAddress = await sortedTroves.troveManager()
    assert.equal(troveManagerAddress, recordedTroveManagerAddress)
  })

  //--- BorrowerOperations ---

  // TroveManager in BO
  it('Sets the correct TroveManager address in BorrowerOperations', async () => {
    const troveManagerAddress = troveManager.address

    const recordedTroveManagerAddress = await borrowerOperations.troveManager()
    assert.equal(troveManagerAddress, recordedTroveManagerAddress)
  })

  // setPriceFeed in BO
  it('Sets the correct PriceFeed address in BorrowerOperations', async () => {
    const priceFeedAddress = priceFeed.address

    const recordedPriceFeedAddress = await borrowerOperations.priceFeed()
    assert.equal(priceFeedAddress, recordedPriceFeedAddress)
  })

  // setSortedTroves in BO
  it('Sets the correct SortedTroves address in BorrowerOperations', async () => {
    const sortedTrovesAddress = sortedTroves.address

    const recordedSortedTrovesAddress = await borrowerOperations.sortedTroves()
    assert.equal(sortedTrovesAddress, recordedSortedTrovesAddress)
  })

  // setActivePool in BO
  it('Sets the correct ActivePool address in BorrowerOperations', async () => {
    const activePoolAddress = activePool.address

    const recordedActivePoolAddress = await borrowerOperations.activePool()
    assert.equal(activePoolAddress, recordedActivePoolAddress)
  })

  // setDefaultPool in BO
  it('Sets the correct DefaultPool address in BorrowerOperations', async () => {
    const defaultPoolAddress = defaultPool.address

    const recordedDefaultPoolAddress = await borrowerOperations.defaultPool()
    assert.equal(defaultPoolAddress, recordedDefaultPoolAddress)
  })

  // SABLE Staking in BO
  it('Sets the correct SABLEStaking address in BorrowerOperations', async () => {
    const sableStakingAddress = sableStaking.address

    const recordedSABLEStakingAddress = await borrowerOperations.sableStakingAddress()
    assert.equal(sableStakingAddress, recordedSABLEStakingAddress)
  })


  // --- SABLE Staking ---

  // Sets SABLEToken in SABLEStaking
  it('Sets the correct SABLEToken address in SABLEStaking', async () => {
    const sableTokenAddress = sableToken.address

    const recordedSABLETokenAddress = await sableStaking.sableToken()
    assert.equal(sableTokenAddress, recordedSABLETokenAddress)
  })

  // Sets ActivePool in SABLEStaking
  it('Sets the correct ActivePool address in SABLEStaking', async () => {
    const activePoolAddress = activePool.address

    const recordedActivePoolAddress = await sableStaking.activePoolAddress()
    assert.equal(activePoolAddress, recordedActivePoolAddress)
  })

  // Sets USDSToken in SABLEStaking
  it('Sets the correct ActivePool address in SABLEStaking', async () => {
    const usdsTokenAddress = usdsToken.address

    const recordedUSDSTokenAddress = await sableStaking.usdsToken()
    assert.equal(usdsTokenAddress, recordedUSDSTokenAddress)
  })

  // Sets TroveManager in SABLEStaking
  it('Sets the correct ActivePool address in SABLEStaking', async () => {
    const troveManagerAddress = troveManager.address

    const recordedTroveManagerAddress = await sableStaking.troveManagerAddress()
    assert.equal(troveManagerAddress, recordedTroveManagerAddress)
  })

  // Sets BorrowerOperations in SABLEStaking
  it('Sets the correct BorrowerOperations address in SABLEStaking', async () => {
    const borrowerOperationsAddress = borrowerOperations.address

    const recordedBorrowerOperationsAddress = await sableStaking.borrowerOperationsAddress()
    assert.equal(borrowerOperationsAddress, recordedBorrowerOperationsAddress)
  })

  // ---  SABLEToken ---


  // Sets SABLEStaking in SABLEToken
  it('Sets the correct SABLEStaking address in SABLEToken', async () => {
    const sableStakingAddress = sableStaking.address

    const recordedSABLEStakingAddress =  await sableToken.sableStakingAddress()
    assert.equal(sableStakingAddress, recordedSABLEStakingAddress)
  })

  // --- CI ---

  // Sets SABLEToken in CommunityIssuance
  it('Sets the correct SABLEToken address in CommunityIssuance', async () => {
    const sableTokenAddress = sableToken.address

    const recordedSABLETokenAddress = await communityIssuance.sableToken()
    assert.equal(sableTokenAddress, recordedSABLETokenAddress)
  })

  it('Sets the correct StabilityPool address in CommunityIssuance', async () => {
    const stabilityPoolAddress = stabilityPool.address

    const recordedStabilityPoolAddress = await communityIssuance.stabilityPool()
    assert.equal(stabilityPoolAddress, recordedStabilityPoolAddress)
  })
})