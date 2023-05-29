// SPDX-License-Identifier: MIT

pragma solidity 0.6.11;
pragma experimental ABIEncoderV2;

import "../TroveManager.sol";
import "../BorrowerOperations.sol";
import "../ActivePool.sol";
import "../DefaultPool.sol";
import "../StabilityPool.sol";
import "../GasPool.sol";
import "../CollSurplusPool.sol";
import "../USDSToken.sol";
import "./PriceFeedTestnet.sol";
import "../SortedTroves.sol";
import "./EchidnaProxy.sol";
import "../SystemState.sol";
import "../TimeLock.sol";
import "../OracleRateCalculation.sol";
import "../TroveHelper.sol";
import "../Interfaces/IBorrowerOperations.sol";
import "../Interfaces/ITroveManager.sol";
import "../Interfaces/ITroveHelper.sol";

//import "../Dependencies/console.sol";

// Run with:
// rm -f fuzzTests/corpus/* # (optional)
// ~/.local/bin/echidna-test contracts/TestContracts/EchidnaTester.sol --contract EchidnaTester --config fuzzTests/echidna_config.yaml

contract EchidnaTester {
    using SafeMath for uint;

    uint private constant NUMBER_OF_ACTORS = 100;
    uint private constant INITIAL_BALANCE = 1e24;
    uint private MCR;
    uint private CCR;
    uint private USDS_GAS_COMPENSATION;

    TroveManager public troveManager;
    BorrowerOperations public borrowerOperations;
    ActivePool public activePool;
    DefaultPool public defaultPool;
    StabilityPool public stabilityPool;
    GasPool public gasPool;
    CollSurplusPool public collSurplusPool;
    USDSToken public usdsToken;
    PriceFeedTestnet priceFeedTestnet;
    SortedTroves sortedTroves;
    SystemState systemState;
    TimeLock timeLock;
    OracleRateCalculation oracleRateCalc;
    TroveHelper troveHelper;

    EchidnaProxy[NUMBER_OF_ACTORS] public echidnaProxies;

    uint private numberOfTroves;

    constructor() public payable {
        troveManager = new TroveManager();
        borrowerOperations = new BorrowerOperations();
        activePool = new ActivePool();
        defaultPool = new DefaultPool();
        stabilityPool = new StabilityPool();
        gasPool = new GasPool();
        address[] memory paramsTimeLock;
        timeLock = new TimeLock(100, paramsTimeLock, paramsTimeLock);
        systemState = new SystemState();
        usdsToken = new USDSToken(
            address(troveManager),
            address(stabilityPool), 
            address(borrowerOperations)
        );

        collSurplusPool = new CollSurplusPool();
        priceFeedTestnet = new PriceFeedTestnet();

        sortedTroves = new SortedTroves();
        troveHelper = new TroveHelper();

        ITroveManager.DependencyAddressParam memory troveManagerAddressParam = ITroveManager
            .DependencyAddressParam({
                borrowerOperationsAddress: address(borrowerOperations),
                activePoolAddress: address(activePool),
                defaultPoolAddress: address(defaultPool),
                stabilityPoolAddress: address(stabilityPool),
                gasPoolAddress: address(gasPool),
                collSurplusPoolAddress: address(collSurplusPool),
                priceFeedAddress: address(priceFeedTestnet),
                usdsTokenAddress: address(usdsToken),
                sortedTrovesAddress: address(sortedTroves),
                sableTokenAddress: address(0),
                sableStakingAddress: address(0),
                systemStateAddress: address(systemState),
                oracleRateCalcAddress: address(oracleRateCalc),
                troveHelperAddress: address(troveHelper)
            });

        troveManager.setAddresses(troveManagerAddressParam);

        IBorrowerOperations.DependencyAddressParam memory borrowerAddressParam = IBorrowerOperations
            .DependencyAddressParam({
                troveManagerAddress: address(troveManager),
                activePoolAddress: address(activePool),
                defaultPoolAddress: address(defaultPool),
                stabilityPoolAddress: address(stabilityPool),
                gasPoolAddress: address(gasPool),
                collSurplusPoolAddress: address(collSurplusPool),
                priceFeedAddress: address(priceFeedTestnet),
                sortedTrovesAddress: address(sortedTroves),
                usdsTokenAddress: address(usdsToken),
                sableStakingAddress: address(0),
                systemStateAddress: address(systemState),
                oracleRateCalcAddress: address(oracleRateCalc)
            });

        borrowerOperations.setAddresses(borrowerAddressParam);

        activePool.setAddresses(
            address(borrowerOperations),
            address(troveManager),
            address(stabilityPool),
            address(defaultPool)
        );

        defaultPool.setAddresses(address(troveManager), address(activePool));

        stabilityPool.setParams(
            address(borrowerOperations),
            address(troveManager),
            address(activePool),
            address(usdsToken),
            address(sortedTroves),
            address(priceFeedTestnet),
            address(0),
            address(systemState)
        );

        collSurplusPool.setAddresses(
            address(borrowerOperations),
            address(troveManager),
            address(activePool)
        );

        systemState.setConfigs(
            address(timeLock),
            1100000000000000000,
            1500000000000000000,
            200e18,
            1800e18,
            5e15,
            5e15
        );

        sortedTroves.setParams(1e18, address(troveManager), address(borrowerOperations));

        for (uint i = 0; i < NUMBER_OF_ACTORS; i++) {
            echidnaProxies[i] = new EchidnaProxy(
                troveManager,
                borrowerOperations,
                stabilityPool,
                usdsToken
            );
            (bool success, ) = address(echidnaProxies[i]).call{value: INITIAL_BALANCE}("");
            require(success);
        }

        MCR = systemState.getMCR();
        CCR = systemState.getCCR();
        USDS_GAS_COMPENSATION = systemState.getUSDSGasCompensation();
        require(MCR > 0);
        require(CCR > 0);

        // TODO:
        priceFeedTestnet.setPrice(1e22);
    }

    // TroveManager

    function liquidateExt(
        uint _i,
        address _user,
        bytes[] calldata priceFeedUpdateData
    ) external {
        uint actor = _i % NUMBER_OF_ACTORS;
        echidnaProxies[actor].liquidatePrx(_user, priceFeedUpdateData);
    }

    function liquidateTrovesExt(
        uint _i,
        uint _n,
        bytes[] calldata priceFeedUpdateData
    ) external {
        uint actor = _i % NUMBER_OF_ACTORS;
        echidnaProxies[actor].liquidateTrovesPrx(_n, priceFeedUpdateData);
    }

    function batchLiquidateTrovesExt(
        uint _i,
        address[] calldata _troveArray,
        bytes[] calldata priceFeedUpdateData
    ) external {
        uint actor = _i % NUMBER_OF_ACTORS;
        echidnaProxies[actor].batchLiquidateTrovesPrx(_troveArray, priceFeedUpdateData);
    }

    function redeemCollateralExt(
        uint _i,
        uint _USDSAmount,
        address _firstRedemptionHint,
        address _upperPartialRedemptionHint,
        address _lowerPartialRedemptionHint,
        uint _partialRedemptionHintNICR,
        bytes[] calldata priceFeedUpdateData
    ) external {
        uint actor = _i % NUMBER_OF_ACTORS;
        echidnaProxies[actor].redeemCollateralPrx(
            _USDSAmount,
            _firstRedemptionHint,
            _upperPartialRedemptionHint,
            _lowerPartialRedemptionHint,
            _partialRedemptionHintNICR,
            0,
            0,
            priceFeedUpdateData
        );
    }

    // Borrower Operations

    function getAdjustedBNB(uint actorBalance, uint _BNB, uint ratio) internal view returns (uint) {
        uint price = priceFeedTestnet.getPrice();
        require(price > 0);
        uint minBNB = ratio.mul(USDS_GAS_COMPENSATION).div(price);
        require(actorBalance > minBNB);
        uint BNB = minBNB + (_BNB % (actorBalance - minBNB));
        return BNB;
    }

    function getAdjustedUSDS(uint BNB, uint _USDSAmount, uint ratio) internal view returns (uint) {
        uint price = priceFeedTestnet.getPrice();
        uint USDSAmount = _USDSAmount;
        uint compositeDebt = USDSAmount.add(USDS_GAS_COMPENSATION);
        uint ICR = LiquityMath._computeCR(BNB, compositeDebt, price);
        if (ICR < ratio) {
            compositeDebt = BNB.mul(price).div(ratio);
            USDSAmount = compositeDebt.sub(USDS_GAS_COMPENSATION);
        }
        return USDSAmount;
    }

    function openTroveExt(
        uint _i,
        uint _BNB,
        uint _USDSAmount,
        bytes[] calldata priceFeedUpdateData
    ) public payable {
        uint actor = _i % NUMBER_OF_ACTORS;
        EchidnaProxy echidnaProxy = echidnaProxies[actor];
        uint actorBalance = address(echidnaProxy).balance;

        // we pass in CCR instead of MCR in case it’s the first one
        uint BNB = getAdjustedBNB(actorBalance, _BNB, CCR);
        uint USDSAmount = getAdjustedUSDS(BNB, _USDSAmount, CCR);

        //console.log('BNB', BNB);
        //console.log('USDSAmount', USDSAmount);

        echidnaProxy.openTrovePrx(BNB, USDSAmount, address(0), address(0), 0, priceFeedUpdateData);

        numberOfTroves = troveManager.getTroveOwnersCount();
        assert(numberOfTroves > 0);
        // canary
        //assert(numberOfTroves == 0);
    }

    function openTroveRawExt(
        uint _i,
        uint _BNB,
        uint _USDSAmount,
        address _upperHint,
        address _lowerHint,
        uint _maxFee,
        bytes[] calldata priceFeedUpdateData
    ) public payable {
        uint actor = _i % NUMBER_OF_ACTORS;
        echidnaProxies[actor].openTrovePrx(
            _BNB,
            _USDSAmount,
            _upperHint,
            _lowerHint,
            _maxFee,
            priceFeedUpdateData
        );
    }

    function addCollExt(uint _i, uint _BNB, bytes[] calldata priceFeedUpdateData) external payable {
        uint actor = _i % NUMBER_OF_ACTORS;
        EchidnaProxy echidnaProxy = echidnaProxies[actor];
        uint actorBalance = address(echidnaProxy).balance;

        uint BNB = getAdjustedBNB(actorBalance, _BNB, MCR);

        echidnaProxy.addCollPrx(BNB, address(0), address(0), priceFeedUpdateData);
    }

    function addCollRawExt(
        uint _i,
        uint _BNB,
        address _upperHint,
        address _lowerHint,
        bytes[] calldata priceFeedUpdateData
    ) external payable {
        uint actor = _i % NUMBER_OF_ACTORS;
        echidnaProxies[actor].addCollPrx(_BNB, _upperHint, _lowerHint, priceFeedUpdateData);
    }

    function withdrawCollExt(
        uint _i,
        uint _amount,
        address _upperHint,
        address _lowerHint,
        bytes[] calldata priceFeedUpdateData
    ) external {
        uint actor = _i % NUMBER_OF_ACTORS;
        echidnaProxies[actor].withdrawCollPrx(_amount, _upperHint, _lowerHint, priceFeedUpdateData);
    }

    function withdrawUSDSExt(
        uint _i,
        uint _amount,
        address _upperHint,
        address _lowerHint,
        uint _maxFee,
        bytes[] calldata priceFeedUpdateData
    ) external {
        uint actor = _i % NUMBER_OF_ACTORS;
        echidnaProxies[actor].withdrawUSDSPrx(
            _amount,
            _upperHint,
            _lowerHint,
            _maxFee,
            priceFeedUpdateData
        );
    }

    function repayUSDSExt(
        uint _i,
        uint _amount,
        address _upperHint,
        address _lowerHint,
        bytes[] calldata priceFeedUpdateData
    ) external {
        uint actor = _i % NUMBER_OF_ACTORS;
        echidnaProxies[actor].repayUSDSPrx(_amount, _upperHint, _lowerHint, priceFeedUpdateData);
    }

    function closeTroveExt(uint _i, bytes[] calldata priceFeedUpdateData) external {
        uint actor = _i % NUMBER_OF_ACTORS;
        echidnaProxies[actor].closeTrovePrx(priceFeedUpdateData);
    }

    function adjustTroveExt(
        uint _i,
        uint _BNB,
        uint _collWithdrawal,
        uint _debtChange,
        bool _isDebtIncrease,
        bytes[] calldata priceFeedUpdateData
    ) external payable {
        uint actor = _i % NUMBER_OF_ACTORS;
        EchidnaProxy echidnaProxy = echidnaProxies[actor];
        uint actorBalance = address(echidnaProxy).balance;

        uint BNB = getAdjustedBNB(actorBalance, _BNB, MCR);
        uint debtChange = _debtChange;
        if (_isDebtIncrease) {
            // TODO: add current amount already withdrawn:
            debtChange = getAdjustedUSDS(BNB, uint(_debtChange), MCR);
        }
        // TODO: collWithdrawal, debtChange

        IBorrowerOperations.AdjustTroveParam memory adjustParam = IBorrowerOperations
            .AdjustTroveParam({
                collWithdrawal: _collWithdrawal,
                USDSChange: debtChange,
                isDebtIncrease: _isDebtIncrease,
                upperHint: address(0),
                lowerHint: address(0),
                maxFeePercentage: 0
            });
        echidnaProxy.adjustTrovePrx(BNB, adjustParam, priceFeedUpdateData);
    }

    function adjustTroveRawExt(
        uint _i,
        uint _BNB,
        IBorrowerOperations.AdjustTroveParam memory adjustParam,
        bytes[] calldata priceFeedUpdateData
    ) external payable {
        uint actor = _i % NUMBER_OF_ACTORS;
        echidnaProxies[actor].adjustTrovePrx(_BNB, adjustParam, priceFeedUpdateData);
    }

    // Pool Manager

    function provideToSPExt(uint _i, uint _amount, address _frontEndTag) external {
        uint actor = _i % NUMBER_OF_ACTORS;
        echidnaProxies[actor].provideToSPPrx(_amount, _frontEndTag);
    }

    function withdrawFromSPExt(
        uint _i,
        uint _amount,
        bytes[] calldata priceFeedUpdateData
    ) external {
        uint actor = _i % NUMBER_OF_ACTORS;
        echidnaProxies[actor].withdrawFromSPPrx(_amount, priceFeedUpdateData);
    }

    // USDS Token

    function transferExt(uint _i, address recipient, uint256 amount) external returns (bool) {
        uint actor = _i % NUMBER_OF_ACTORS;
        echidnaProxies[actor].transferPrx(recipient, amount);
    }

    function approveExt(uint _i, address spender, uint256 amount) external returns (bool) {
        uint actor = _i % NUMBER_OF_ACTORS;
        echidnaProxies[actor].approvePrx(spender, amount);
    }

    function transferFromExt(
        uint _i,
        address sender,
        address recipient,
        uint256 amount
    ) external returns (bool) {
        uint actor = _i % NUMBER_OF_ACTORS;
        echidnaProxies[actor].transferFromPrx(sender, recipient, amount);
    }

    function increaseAllowanceExt(
        uint _i,
        address spender,
        uint256 addedValue
    ) external returns (bool) {
        uint actor = _i % NUMBER_OF_ACTORS;
        echidnaProxies[actor].increaseAllowancePrx(spender, addedValue);
    }

    function decreaseAllowanceExt(
        uint _i,
        address spender,
        uint256 subtractedValue
    ) external returns (bool) {
        uint actor = _i % NUMBER_OF_ACTORS;
        echidnaProxies[actor].decreaseAllowancePrx(spender, subtractedValue);
    }

    // PriceFeed

    function setPriceExt(uint256 _price) external {
        bool result = priceFeedTestnet.setPrice(_price);
        assert(result);
    }

    // --------------------------
    // Invariants and properties
    // --------------------------

    function echidna_canary_number_of_troves() public view returns (bool) {
        if (numberOfTroves > 20) {
            return false;
        }

        return true;
    }

    function echidna_canary_active_pool_balance() public view returns (bool) {
        if (address(activePool).balance > 0) {
            return false;
        }
        return true;
    }

    function echidna_troves_order() external view returns (bool) {
        address currentTrove = sortedTroves.getFirst();
        address nextTrove = sortedTroves.getNext(currentTrove);

        while (currentTrove != address(0) && nextTrove != address(0)) {
            if (troveManager.getNominalICR(nextTrove) > troveManager.getNominalICR(currentTrove)) {
                return false;
            }
            // Uncomment to check that the condition is meaningful
            //else return false;

            currentTrove = nextTrove;
            nextTrove = sortedTroves.getNext(currentTrove);
        }

        return true;
    }

    /**
     * Status
     * Minimum debt (gas compensation)
     * Stake > 0
     */
    function echidna_trove_properties() public view returns (bool) {
        address currentTrove = sortedTroves.getFirst();
        while (currentTrove != address(0)) {
            // Status
            if (
                ITroveManager.Status(troveManager.getTroveStatus(currentTrove)) !=
                ITroveManager.Status.active
            ) {
                return false;
            }
            // Uncomment to check that the condition is meaningful
            //else return false;

            // Minimum debt (gas compensation)
            if (troveManager.getTroveDebt(currentTrove) < USDS_GAS_COMPENSATION) {
                return false;
            }
            // Uncomment to check that the condition is meaningful
            //else return false;

            // Stake > 0
            if (troveManager.getTroveStake(currentTrove) == 0) {
                return false;
            }
            // Uncomment to check that the condition is meaningful
            //else return false;

            currentTrove = sortedTroves.getNext(currentTrove);
        }
        return true;
    }

    function echidna_BNB_balances() public view returns (bool) {
        if (address(troveManager).balance > 0) {
            return false;
        }

        if (address(borrowerOperations).balance > 0) {
            return false;
        }

        if (address(activePool).balance != activePool.getBNB()) {
            return false;
        }

        if (address(defaultPool).balance != defaultPool.getBNB()) {
            return false;
        }

        if (address(stabilityPool).balance != stabilityPool.getBNB()) {
            return false;
        }

        if (address(usdsToken).balance > 0) {
            return false;
        }

        if (address(priceFeedTestnet).balance > 0) {
            return false;
        }

        if (address(sortedTroves).balance > 0) {
            return false;
        }

        return true;
    }

    // TODO: What should we do with this? Should it be allowed? Should it be a canary?
    function echidna_price() public view returns (bool) {
        uint price = priceFeedTestnet.getPrice();

        if (price == 0) {
            return false;
        }
        // Uncomment to check that the condition is meaningful
        //else return false;

        return true;
    }

    // Total USDS matches
    function echidna_USDS_global_balances() public view returns (bool) {
        uint totalSupply = usdsToken.totalSupply();
        uint gasPoolBalance = usdsToken.balanceOf(address(gasPool));

        uint activePoolBalance = activePool.getUSDSDebt();
        uint defaultPoolBalance = defaultPool.getUSDSDebt();
        if (totalSupply != activePoolBalance + defaultPoolBalance) {
            return false;
        }

        uint stabilityPoolBalance = stabilityPool.getTotalUSDSDeposits();
        address currentTrove = sortedTroves.getFirst();
        uint trovesBalance;
        while (currentTrove != address(0)) {
            trovesBalance += usdsToken.balanceOf(address(currentTrove));
            currentTrove = sortedTroves.getNext(currentTrove);
        }
        // we cannot state equality because tranfers are made to external addresses too
        if (totalSupply <= stabilityPoolBalance + trovesBalance + gasPoolBalance) {
            return false;
        }

        return true;
    }

    /*
    function echidna_test() public view returns(bool) {
        return true;
    }
    */
}
