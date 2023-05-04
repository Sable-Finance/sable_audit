const SortedTroves = artifacts.require("./SortedTroves.sol");
const TroveManager = artifacts.require("./TroveManager.sol");
const PriceFeedTestnet = artifacts.require("./PriceFeedTestnet.sol");
const LUSDToken = artifacts.require("./LUSDToken.sol");
const ActivePool = artifacts.require("./ActivePool.sol");
const DefaultPool = artifacts.require("./DefaultPool.sol");
const StabilityPool = artifacts.require("./StabilityPool.sol");
const GasPool = artifacts.require("./GasPool.sol");
const CollSurplusPool = artifacts.require("./CollSurplusPool.sol");
const FunctionCaller = artifacts.require("./TestContracts/FunctionCaller.sol");
const BorrowerOperations = artifacts.require("./BorrowerOperations.sol");
const HintHelpers = artifacts.require("./HintHelpers.sol");
const SystemState = artifacts.require("./SystemState.sol");
const TimeLock = artifacts.require("./TimeLock.sol");
const MockPyth = artifacts.require("./MockPyth.sol");
const OracleRateCalculation = artifacts.require("./OracleRateCalculation.sol");
const TroveHelper = artifacts.require("./TroveHelper.sol");

const LQTYStaking = artifacts.require("./LQTYStaking.sol");
const LQTYToken = artifacts.require("./LQTYToken.sol");
const CommunityIssuance = artifacts.require("./CommunityIssuance.sol");

const LQTYTokenTester = artifacts.require("./LQTYTokenTester.sol");
const CommunityIssuanceTester = artifacts.require("./CommunityIssuanceTester.sol");
const StabilityPoolTester = artifacts.require("./StabilityPoolTester.sol");
const ActivePoolTester = artifacts.require("./ActivePoolTester.sol");
const DefaultPoolTester = artifacts.require("./DefaultPoolTester.sol");
const LiquityMathTester = artifacts.require("./LiquityMathTester.sol");
const BorrowerOperationsTester = artifacts.require("./BorrowerOperationsTester.sol");
const TroveManagerTester = artifacts.require("./TroveManagerTester.sol");
const LUSDTokenTester = artifacts.require("./LUSDTokenTester.sol");

// Proxy scripts
const BorrowerOperationsScript = artifacts.require("BorrowerOperationsScript");
const BorrowerWrappersScript = artifacts.require("BorrowerWrappersScript");
const TroveManagerScript = artifacts.require("TroveManagerScript");
const StabilityPoolScript = artifacts.require("StabilityPoolScript");
const TokenScript = artifacts.require("TokenScript");
const LQTYStakingScript = artifacts.require("LQTYStakingScript");
const testHelpers = require("./testHelpers.js");

const hardHatAddressDeployDefault = "0x31c57298578f7508B5982062cfEc5ec8BD346247";


const {
  buildUserProxies,
  BorrowerOperationsProxy,
  BorrowerWrappersProxy,
  TroveManagerProxy,
  StabilityPoolProxy,
  SortedTrovesProxy,
  TokenProxy,
  LQTYStakingProxy
} = require("../utils/proxyHelpers.js");

/* "Liquity core" consists of all contracts in the core Liquity system.

LQTY contracts consist of only those contracts related to the LQTY Token:

-the LQTY token
-the Lockup factory and lockup contracts
-the LQTYStaking contract
-the CommunityIssuance contract 
*/

const ZERO_ADDRESS = "0x" + "0".repeat(40);
const maxBytes32 = "0x" + "f".repeat(64);

const th = testHelpers.TestHelper;
const toBN = th.toBN;
const dec = th.dec

class DeploymentHelper {
  static async deployLiquityCore() {
    const cmdLineArgs = process.argv;
    const frameworkPath = cmdLineArgs[1];
    // console.log(`Framework used:  ${frameworkPath}`)

    if (frameworkPath.includes("hardhat")) {
      return this.deployLiquityCoreHardhat();
    } else if (frameworkPath.includes("truffle")) {
      return this.deployLiquityCoreTruffle();
    }
  }

  static async deployLQTYContracts(vaultAddress, mintAmount) {
    const cmdLineArgs = process.argv;
    const frameworkPath = cmdLineArgs[1];
    // console.log(`Framework used:  ${frameworkPath}`)

    if (frameworkPath.includes("hardhat")) {
      return this.deployLQTYContractsHardhat(vaultAddress, mintAmount);
    } else if (frameworkPath.includes("truffle")) {
      return this.deployLQTYContractsTruffle(vaultAddress, mintAmount);
    }
  }

  static async deployLiquityCoreHardhat() {
    const priceFeedTestnet = await PriceFeedTestnet.new();
    const sortedTroves = await SortedTroves.new();
    const troveManager = await TroveManager.new();
    const activePool = await ActivePool.new();
    const stabilityPool = await StabilityPool.new();
    const gasPool = await GasPool.new();
    const defaultPool = await DefaultPool.new();
    const collSurplusPool = await CollSurplusPool.new();
    const functionCaller = await FunctionCaller.new();
    const borrowerOperations = await BorrowerOperations.new();
    const hintHelpers = await HintHelpers.new();
    const lusdToken = await LUSDToken.new(
      troveManager.address,
      stabilityPool.address,
      borrowerOperations.address
    );
    const timeLock = await TimeLock.new(
      10,
      [hardHatAddressDeployDefault],
      [hardHatAddressDeployDefault]
    );
    const systemState = await SystemState.new();
    const oracleCalc = await OracleRateCalculation.new();
    const mockPyth = await MockPyth.new(0, 1);
    const troveHelper = await TroveHelper.new();

    LUSDToken.setAsDeployed(lusdToken);
    DefaultPool.setAsDeployed(defaultPool);
    PriceFeedTestnet.setAsDeployed(priceFeedTestnet);
    SortedTroves.setAsDeployed(sortedTroves);
    TroveManager.setAsDeployed(troveManager);
    ActivePool.setAsDeployed(activePool);
    StabilityPool.setAsDeployed(stabilityPool);
    GasPool.setAsDeployed(gasPool);
    CollSurplusPool.setAsDeployed(collSurplusPool);
    FunctionCaller.setAsDeployed(functionCaller);
    BorrowerOperations.setAsDeployed(borrowerOperations);
    HintHelpers.setAsDeployed(hintHelpers);
    TimeLock.setAsDeployed(timeLock);
    SystemState.setAsDeployed(systemState);
    OracleRateCalculation.setAsDeployed(oracleCalc);
    MockPyth.setAsDeployed(mockPyth);
    TroveHelper.setAsDeployed(troveHelper);

    const coreContracts = {
      priceFeedTestnet,
      lusdToken,
      sortedTroves,
      troveManager,
      activePool,
      stabilityPool,
      gasPool,
      defaultPool,
      collSurplusPool,
      functionCaller,
      borrowerOperations,
      hintHelpers,
      timeLock,
      systemState,
      oracleCalc,
      mockPyth,
      troveHelper
    };
    return coreContracts;
  }

  static async deployTesterContractsHardhat() {
    const testerContracts = {};

    // Contract without testers (yet)
    testerContracts.priceFeedTestnet = await PriceFeedTestnet.new();
    testerContracts.sortedTroves = await SortedTroves.new();
    // Actual tester contracts
    testerContracts.communityIssuance = await CommunityIssuanceTester.new();
    testerContracts.activePool = await ActivePoolTester.new();
    testerContracts.defaultPool = await DefaultPoolTester.new();
    testerContracts.stabilityPool = await StabilityPoolTester.new();
    testerContracts.gasPool = await GasPool.new();
    testerContracts.collSurplusPool = await CollSurplusPool.new();
    testerContracts.math = await LiquityMathTester.new();
    testerContracts.borrowerOperations = await BorrowerOperationsTester.new();
    testerContracts.troveManager = await TroveManagerTester.new();
    testerContracts.functionCaller = await FunctionCaller.new();
    testerContracts.hintHelpers = await HintHelpers.new();
    testerContracts.lusdToken = await LUSDTokenTester.new(
      testerContracts.troveManager.address,
      testerContracts.stabilityPool.address,
      testerContracts.borrowerOperations.address
    );
    testerContracts.timeLock = await TimeLock.new(
      10,
      [hardHatAddressDeployDefault],
      [hardHatAddressDeployDefault]
    );
    testerContracts.systemState = await SystemState.new(testerContracts.timeLock.address);
    testerContracts.oracleCalc = await OracleRateCalculation.new();
    testerContracts.mockPyth = await MockPyth.new(0, 1);
    testerContracts.troveHelper = await TroveHelper.new();
    return testerContracts;
  }

  static async deployLQTYContractsHardhat(vaultAddress, mintAmount) {
    const lqtyStaking = await LQTYStaking.new();
    const communityIssuance = await CommunityIssuance.new();

    LQTYStaking.setAsDeployed(lqtyStaking);
    CommunityIssuance.setAsDeployed(communityIssuance);

    // Deploy LQTY Token, passing Community Issuance and Factory addresses to the constructor
    const lqtyToken = await LQTYToken.new(
      lqtyStaking.address,
      vaultAddress,
      mintAmount
    );
    LQTYToken.setAsDeployed(lqtyToken);

    const LQTYContracts = {
      lqtyStaking,
      communityIssuance,
      lqtyToken
    };
    return LQTYContracts;
  }

  static async deployLQTYTesterContractsHardhat(vaultAddress, mintAmount) {
    const lqtyStaking = await LQTYStaking.new();
    const communityIssuance = await CommunityIssuanceTester.new();

    LQTYStaking.setAsDeployed(lqtyStaking);
    CommunityIssuanceTester.setAsDeployed(communityIssuance);

    // Deploy LQTY Token, passing Community Issuance and Factory addresses to the constructor
    const lqtyToken = await LQTYTokenTester.new(
      lqtyStaking.address,
      vaultAddress,
      mintAmount
    );
    LQTYTokenTester.setAsDeployed(lqtyToken);

    const LQTYContracts = {
      lqtyStaking,
      communityIssuance,
      lqtyToken
    };
    return LQTYContracts;
  }

  static async deployLiquityCoreTruffle() {
    const priceFeedTestnet = await PriceFeedTestnet.new();
    const sortedTroves = await SortedTroves.new();
    const troveManager = await TroveManager.new();
    const activePool = await ActivePool.new();
    const stabilityPool = await StabilityPool.new();
    const gasPool = await GasPool.new();
    const defaultPool = await DefaultPool.new();
    const collSurplusPool = await CollSurplusPool.new();
    const functionCaller = await FunctionCaller.new();
    const borrowerOperations = await BorrowerOperations.new();
    const hintHelpers = await HintHelpers.new();
    const lusdToken = await LUSDToken.new(
      troveManager.address,
      stabilityPool.address,
      borrowerOperations.address
    );
    const timeLock = await TimeLock.new(
      10,
      [hardHatAddressDeployDefault],
      [hardHatAddressDeployDefault]
    );
    const systemState = await SystemState.new();
    const oracleCalc = await OracleRateCalculation.new();
    const mockPyth = await MockPyth.new(0, 1);
    const troveHelper = await TroveHelper.new();

    const coreContracts = {
      priceFeedTestnet,
      lusdToken,
      sortedTroves,
      troveManager,
      activePool,
      stabilityPool,
      gasPool,
      defaultPool,
      collSurplusPool,
      functionCaller,
      borrowerOperations,
      hintHelpers,
      timeLock,
      systemState,
      oracleCalc,
      mockPyth,
      troveHelper
    };
    return coreContracts;
  }

  static async deployLQTYContractsTruffle(vaultAddress, mintAmount) {
    const lqtyStaking = await lqtyStaking.new();
    const communityIssuance = await CommunityIssuance.new();

    /* Deploy LQTY Token, passing Community Issuance,  LQTYStaking, and Factory addresses 
    to the constructor  */
    const lqtyToken = await LQTYToken.new(
      lqtyStaking.address,
      vaultAddress,
      mintAmount
    );

    const LQTYContracts = {
      lqtyStaking,
      communityIssuance,
      lqtyToken
    };
    return LQTYContracts;
  }

  static async deployLUSDToken(contracts) {
    contracts.lusdToken = await LUSDToken.new(
      contracts.troveManager.address,
      contracts.stabilityPool.address,
      contracts.borrowerOperations.address
    );
    return contracts;
  }

  static async deployLUSDTokenTester(contracts) {
    contracts.lusdToken = await LUSDTokenTester.new(
      contracts.troveManager.address,
      contracts.stabilityPool.address,
      contracts.borrowerOperations.address
    );
    return contracts;
  }

  static async deployProxyScripts(contracts, LQTYContracts, owner, users) {
    const proxies = await buildUserProxies(users);

    const borrowerWrappersScript = await BorrowerWrappersScript.new(
      contracts.borrowerOperations.address,
      contracts.troveManager.address,
      LQTYContracts.lqtyStaking.address
    );
    contracts.borrowerWrappers = new BorrowerWrappersProxy(
      owner,
      proxies,
      borrowerWrappersScript.address
    );

    const borrowerOperationsScript = await BorrowerOperationsScript.new(
      contracts.borrowerOperations.address
    );
    contracts.borrowerOperations = new BorrowerOperationsProxy(
      owner,
      proxies,
      borrowerOperationsScript.address,
      contracts.borrowerOperations
    );

    const troveManagerScript = await TroveManagerScript.new(contracts.troveManager.address);
    contracts.troveManager = new TroveManagerProxy(
      owner,
      proxies,
      troveManagerScript.address,
      contracts.troveManager
    );

    const stabilityPoolScript = await StabilityPoolScript.new(contracts.stabilityPool.address);
    contracts.stabilityPool = new StabilityPoolProxy(
      owner,
      proxies,
      stabilityPoolScript.address,
      contracts.stabilityPool
    );

    contracts.sortedTroves = new SortedTrovesProxy(owner, proxies, contracts.sortedTroves);

    const lusdTokenScript = await TokenScript.new(contracts.lusdToken.address);
    contracts.lusdToken = new TokenProxy(
      owner,
      proxies,
      lusdTokenScript.address,
      contracts.lusdToken
    );

    const lqtyTokenScript = await TokenScript.new(LQTYContracts.lqtyToken.address);
    LQTYContracts.lqtyToken = new TokenProxy(
      owner,
      proxies,
      lqtyTokenScript.address,
      LQTYContracts.lqtyToken
    );

    const lqtyStakingScript = await LQTYStakingScript.new(LQTYContracts.lqtyStaking.address);
    LQTYContracts.lqtyStaking = new LQTYStakingProxy(
      owner,
      proxies,
      lqtyStakingScript.address,
      LQTYContracts.lqtyStaking
    );
  }

  // Connect contracts to their dependencies
  static async connectCoreContracts(contracts, LQTYContracts) {
    // set configs Systemstate
    await contracts.systemState.setConfigs(
      contracts.timeLock.address,
      toBN(1100000000000000000),
      toBN(1500000000000000000),
      toBN((200e18).toString()),
      toBN("1800000000000000000000"), // 1800e18
      toBN((5e15).toString()),
      toBN((5e15).toString())
    );

    // set TroveManager addr in SortedTroves
    await contracts.sortedTroves.setParams(
      maxBytes32,
      contracts.troveManager.address,
      contracts.borrowerOperations.address
    );

    // set contract addresses in the FunctionCaller
    await contracts.functionCaller.setTroveManagerAddress(contracts.troveManager.address);
    await contracts.functionCaller.setSortedTrovesAddress(contracts.sortedTroves.address);

    // set contracts in the Trove Manager
    const TroveManagerAddressesParam = {
      borrowerOperationsAddress: contracts.borrowerOperations.address,
      activePoolAddress: contracts.activePool.address,
      defaultPoolAddress: contracts.defaultPool.address,
      stabilityPoolAddress: contracts.stabilityPool.address,
      gasPoolAddress: contracts.gasPool.address,
      collSurplusPoolAddress: contracts.collSurplusPool.address,
      priceFeedAddress: contracts.priceFeedTestnet.address,
      lusdTokenAddress: contracts.lusdToken.address,
      sortedTrovesAddress: contracts.sortedTroves.address,
      lqtyTokenAddress: LQTYContracts.lqtyToken.address,
      lqtyStakingAddress: LQTYContracts.lqtyStaking.address,
      systemStateAddress: contracts.systemState.address,
      oracleRateCalcAddress: contracts.oracleCalc.address,
      troveHelperAddress: contracts.troveHelper.address
    };

    await contracts.troveManager.setAddresses(TroveManagerAddressesParam);

    // set contracts in BorrowerOperations
    const BorrowerOperationAddressesParam = {
      troveManagerAddress: contracts.troveManager.address,
      activePoolAddress: contracts.activePool.address,
      defaultPoolAddress: contracts.defaultPool.address,
      stabilityPoolAddress: contracts.stabilityPool.address,
      gasPoolAddress: contracts.gasPool.address,
      collSurplusPoolAddress: contracts.collSurplusPool.address,
      priceFeedAddress: contracts.priceFeedTestnet.address,
      sortedTrovesAddress: contracts.sortedTroves.address,
      lusdTokenAddress: contracts.lusdToken.address,
      lqtyStakingAddress: LQTYContracts.lqtyStaking.address,
      systemStateAddress: contracts.systemState.address,
      oracleRateCalcAddress: contracts.oracleCalc.address
    };
    await contracts.borrowerOperations.setAddresses(BorrowerOperationAddressesParam);

    await contracts.priceFeedTestnet.setMockPyth(contracts.mockPyth.address);
    await contracts.priceFeedTestnet.setAddressesTestnet(
      contracts.troveManager.address, 
      contracts.borrowerOperations.address, 
      contracts.stabilityPool.address
    );

    await contracts.troveHelper.setAddresses(
      contracts.troveManager.address,
      contracts.systemState.address,
      contracts.sortedTroves.address,
      LQTYContracts.lqtyToken.address,
      contracts.activePool.address,
      contracts.defaultPool.address
    );

    // set contracts in the Pools
    await contracts.stabilityPool.setParams(
      contracts.borrowerOperations.address,
      contracts.troveManager.address,
      contracts.activePool.address,
      contracts.lusdToken.address,
      contracts.sortedTroves.address,
      contracts.priceFeedTestnet.address,
      LQTYContracts.communityIssuance.address,
      contracts.systemState.address,
      contracts.timeLock.address,
      toBN(1e18)
    );

    await contracts.activePool.setAddresses(
      contracts.borrowerOperations.address,
      contracts.troveManager.address,
      contracts.stabilityPool.address,
      contracts.defaultPool.address
    );

    await contracts.defaultPool.setAddresses(
      contracts.troveManager.address,
      contracts.activePool.address
    );

    await contracts.collSurplusPool.setAddresses(
      contracts.borrowerOperations.address,
      contracts.troveManager.address,
      contracts.activePool.address
    );

    // set contracts in HintHelpers
    await contracts.hintHelpers.setAddresses(
      contracts.sortedTroves.address,
      contracts.troveManager.address,
      contracts.systemState.address
    );
  }

  static async connectLQTYContractsToCore(LQTYContracts, coreContracts) {
    await LQTYContracts.lqtyStaking.setAddresses(
      LQTYContracts.lqtyToken.address,
      coreContracts.lusdToken.address,
      coreContracts.troveManager.address,
      coreContracts.borrowerOperations.address,
      coreContracts.activePool.address
    );

    await LQTYContracts.communityIssuance.setAddresses(
      LQTYContracts.lqtyToken.address,
      coreContracts.stabilityPool.address
    );
  }

}
module.exports = DeploymentHelper;