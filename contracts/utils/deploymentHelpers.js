const SortedTroves = artifacts.require("./SortedTroves.sol");
const TroveManager = artifacts.require("./TroveManager.sol");
const PriceFeedTestnet = artifacts.require("./PriceFeedTestnet.sol");
const USDSToken = artifacts.require("./USDSToken.sol");
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

const SABLEStaking = artifacts.require("./SABLEStaking.sol");
const SABLEToken = artifacts.require("./SABLEToken.sol");
const CommunityIssuance = artifacts.require("./CommunityIssuance.sol");

const SABLETokenTester = artifacts.require("./SABLETokenTester.sol");
const CommunityIssuanceTester = artifacts.require("./CommunityIssuanceTester.sol");
const StabilityPoolTester = artifacts.require("./StabilityPoolTester.sol");
const ActivePoolTester = artifacts.require("./ActivePoolTester.sol");
const DefaultPoolTester = artifacts.require("./DefaultPoolTester.sol");
const LiquityMathTester = artifacts.require("./LiquityMathTester.sol");
const BorrowerOperationsTester = artifacts.require("./BorrowerOperationsTester.sol");
const TroveManagerTester = artifacts.require("./TroveManagerTester.sol");
const USDSTokenTester = artifacts.require("./USDSTokenTester.sol");

// Proxy scripts
const BorrowerOperationsScript = artifacts.require("BorrowerOperationsScript");
const BorrowerWrappersScript = artifacts.require("BorrowerWrappersScript");
const TroveManagerScript = artifacts.require("TroveManagerScript");
const StabilityPoolScript = artifacts.require("StabilityPoolScript");
const TokenScript = artifacts.require("TokenScript");
const SABLEStakingScript = artifacts.require("SABLEStakingScript");
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
  SABLEStakingProxy
} = require("../utils/proxyHelpers.js");

/* "Liquity core" consists of all contracts in the core Liquity system.

SABLE contracts consist of only those contracts related to the SABLE Token:

-the SABLE token
-the Lockup factory and lockup contracts
-the SABLEStaking contract
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

  static async deploySABLEContracts(vaultAddress, mintAmount) {
    const cmdLineArgs = process.argv;
    const frameworkPath = cmdLineArgs[1];
    // console.log(`Framework used:  ${frameworkPath}`)

    if (frameworkPath.includes("hardhat")) {
      return this.deploySABLEContractsHardhat(vaultAddress, mintAmount);
    } else if (frameworkPath.includes("truffle")) {
      return this.deploySABLEContractsTruffle(vaultAddress, mintAmount);
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
    const usdsToken = await USDSToken.new(
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

    USDSToken.setAsDeployed(usdsToken);
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
      usdsToken,
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
    testerContracts.usdsToken = await USDSTokenTester.new(
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

  static async deploySABLEContractsHardhat(vaultAddress, mintAmount) {
    const sableStaking = await SABLEStaking.new();
    const communityIssuance = await CommunityIssuance.new();

    SABLEStaking.setAsDeployed(sableStaking);
    CommunityIssuance.setAsDeployed(communityIssuance);

    // Deploy SABLE Token, passing Community Issuance and Factory addresses to the constructor
    const sableToken = await SABLEToken.new(
      sableStaking.address,
      vaultAddress,
      mintAmount
    );
    SABLEToken.setAsDeployed(sableToken);

    const SABLEContracts = {
      sableStaking,
      communityIssuance,
      sableToken
    };
    return SABLEContracts;
  }

  static async deploySABLETesterContractsHardhat(vaultAddress, mintAmount) {
    const sableStaking = await SABLEStaking.new();
    const communityIssuance = await CommunityIssuanceTester.new();

    SABLEStaking.setAsDeployed(sableStaking);
    CommunityIssuanceTester.setAsDeployed(communityIssuance);

    // Deploy SABLE Token, passing Community Issuance and Factory addresses to the constructor
    const sableToken = await SABLETokenTester.new(
      sableStaking.address,
      vaultAddress,
      mintAmount
    );
    SABLETokenTester.setAsDeployed(sableToken);

    const SABLEContracts = {
      sableStaking,
      communityIssuance,
      sableToken
    };
    return SABLEContracts;
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
    const usdsToken = await USDSToken.new(
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
      usdsToken,
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

  static async deploySABLEContractsTruffle(vaultAddress, mintAmount) {
    const sableStaking = await sableStaking.new();
    const communityIssuance = await CommunityIssuance.new();

    /* Deploy SABLE Token, passing Community Issuance,  SABLEStaking, and Factory addresses 
    to the constructor  */
    const sableToken = await SABLEToken.new(
      sableStaking.address,
      vaultAddress,
      mintAmount
    );

    const SABLEContracts = {
      sableStaking,
      communityIssuance,
      sableToken
    };
    return SABLEContracts;
  }

  static async deployUSDSToken(contracts) {
    contracts.usdsToken = await USDSToken.new(
      contracts.troveManager.address,
      contracts.stabilityPool.address,
      contracts.borrowerOperations.address
    );
    return contracts;
  }

  static async deployUSDSTokenTester(contracts) {
    contracts.usdsToken = await USDSTokenTester.new(
      contracts.troveManager.address,
      contracts.stabilityPool.address,
      contracts.borrowerOperations.address
    );
    return contracts;
  }

  static async deployProxyScripts(contracts, SABLEContracts, owner, users) {
    const proxies = await buildUserProxies(users);

    const borrowerWrappersScript = await BorrowerWrappersScript.new(
      contracts.borrowerOperations.address,
      contracts.troveManager.address,
      SABLEContracts.sableStaking.address
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

    const usdsTokenScript = await TokenScript.new(contracts.usdsToken.address);
    contracts.usdsToken = new TokenProxy(
      owner,
      proxies,
      usdsTokenScript.address,
      contracts.usdsToken
    );

    const sableTokenScript = await TokenScript.new(SABLEContracts.sableToken.address);
    SABLEContracts.sableToken = new TokenProxy(
      owner,
      proxies,
      sableTokenScript.address,
      SABLEContracts.sableToken
    );

    const sableStakingScript = await SABLEStakingScript.new(SABLEContracts.sableStaking.address);
    SABLEContracts.sableStaking = new SABLEStakingProxy(
      owner,
      proxies,
      sableStakingScript.address,
      SABLEContracts.sableStaking
    );
  }

  // Connect contracts to their dependencies
  static async connectCoreContracts(contracts, SABLEContracts) {
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
      usdsTokenAddress: contracts.usdsToken.address,
      sortedTrovesAddress: contracts.sortedTroves.address,
      sableTokenAddress: SABLEContracts.sableToken.address,
      sableStakingAddress: SABLEContracts.sableStaking.address,
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
      usdsTokenAddress: contracts.usdsToken.address,
      sableStakingAddress: SABLEContracts.sableStaking.address,
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
      SABLEContracts.sableToken.address,
      contracts.activePool.address,
      contracts.defaultPool.address
    );

    // set contracts in the Pools
    await contracts.stabilityPool.setParams(
      contracts.borrowerOperations.address,
      contracts.troveManager.address,
      contracts.activePool.address,
      contracts.usdsToken.address,
      contracts.sortedTroves.address,
      contracts.priceFeedTestnet.address,
      SABLEContracts.communityIssuance.address,
      contracts.systemState.address
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

  static async connectSABLEContractsToCore(SABLEContracts, coreContracts) {
    await SABLEContracts.sableStaking.setAddresses(
      SABLEContracts.sableToken.address,
      coreContracts.usdsToken.address,
      coreContracts.troveManager.address,
      coreContracts.borrowerOperations.address,
      coreContracts.activePool.address
    );

    await SABLEContracts.communityIssuance.setParams(
      SABLEContracts.sableToken.address,
      coreContracts.stabilityPool.address,
      toBN(1e18).toString()
    );
  }

}
module.exports = DeploymentHelper;