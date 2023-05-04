// SPDX-License-Identifier: MIT

pragma solidity 0.6.11;
pragma experimental ABIEncoderV2;

import "./Interfaces/IBorrowerOperations.sol";
import "./Interfaces/ITroveManager.sol";
import "./Interfaces/ILUSDToken.sol";
import "./Interfaces/ICollSurplusPool.sol";
import "./Interfaces/ISortedTroves.sol";
import "./Interfaces/ILQTYStaking.sol";
import "./Interfaces/IOracleRateCalculation.sol";
import "./Dependencies/LiquityBase.sol";
import "./Dependencies/Ownable.sol";
import "./Dependencies/CheckContract.sol";
import "./Dependencies/console.sol";

contract BorrowerOperations is LiquityBase, Ownable, CheckContract, IBorrowerOperations {
    string public constant NAME = "BorrowerOperations";

    // --- Connected contract declarations ---

    ITroveManager public troveManager;

    address stabilityPoolAddress;

    address gasPoolAddress;

    ICollSurplusPool collSurplusPool;

    ILQTYStaking public lqtyStaking;
    address public lqtyStakingAddress;

    ILUSDToken public lusdToken;

    // A doubly linked list of Troves, sorted by their collateral ratios
    ISortedTroves public sortedTroves;

    // Oracle rate calculation contract
    IOracleRateCalculation public oracleRateCalc;

    /* --- Variable container structs  ---

    Used to hold, return and assign variables inside a function, in order to avoid the error:
    "CompilerError: Stack too deep". */

    struct LocalVariables_adjustTrove {
        uint price;
        uint collChange;
        uint netDebtChange;
        bool isCollIncrease;
        uint debt;
        uint coll;
        uint oldICR;
        uint newICR;
        uint newTCR;
        uint LUSDFee;
        uint newDebt;
        uint newColl;
        uint stake;
    }

    struct LocalVariables_openTrove {
        uint price;
        uint LUSDFee;
        uint netDebt;
        uint compositeDebt;
        uint ICR;
        uint NICR;
        uint stake;
        uint arrayIndex;
    }

    struct ContractsCache {
        ITroveManager troveManager;
        IActivePool activePool;
        ILUSDToken lusdToken;
    }

    struct MoveTokensAndETHFromAdjustmentParam {
        IActivePool activePool;
        ILUSDToken lusdToken;
        bool isCollIncrease;
        bool isDebtIncrease;
        address borrower;
        uint collChange;
        uint LUSDChange;
        uint netDebtChange;
    }

    enum BorrowerOperation {
        openTrove,
        closeTrove,
        adjustTrove
    }

    event TroveManagerAddressChanged(address _newTroveManagerAddress);
    event ActivePoolAddressChanged(address _activePoolAddress);
    event DefaultPoolAddressChanged(address _defaultPoolAddress);
    event StabilityPoolAddressChanged(address _stabilityPoolAddress);
    event GasPoolAddressChanged(address _gasPoolAddress);
    event CollSurplusPoolAddressChanged(address _collSurplusPoolAddress);
    event PriceFeedAddressChanged(address _newPriceFeedAddress);
    event SortedTrovesAddressChanged(address _sortedTrovesAddress);
    event LUSDTokenAddressChanged(address _lusdTokenAddress);
    event LQTYStakingAddressChanged(address _lqtyStakingAddress);
    event SystemStateAddressChanged(address _systemStateAddress);
    event OracleRateCalcAddressChanged(address _oracleRateCalcAddress);

    event TroveCreated(address indexed _borrower, uint arrayIndex);
    event TroveUpdated(
        address indexed _borrower,
        uint _debt,
        uint _coll,
        uint stake,
        BorrowerOperation operation
    );
    event LUSDBorrowingFeePaid(address indexed _borrower, uint _LUSDFee);

    // --- Dependency setters ---

    function setAddresses(DependencyAddressParam memory param) external override onlyOwner {
        checkContract(param.troveManagerAddress);
        checkContract(param.activePoolAddress);
        checkContract(param.defaultPoolAddress);
        checkContract(param.stabilityPoolAddress);
        checkContract(param.gasPoolAddress);
        checkContract(param.collSurplusPoolAddress);
        checkContract(param.priceFeedAddress);
        checkContract(param.sortedTrovesAddress);
        checkContract(param.lusdTokenAddress);
        checkContract(param.lqtyStakingAddress);
        checkContract(param.systemStateAddress);
        checkContract(param.oracleRateCalcAddress);

        troveManager = ITroveManager(param.troveManagerAddress);
        activePool = IActivePool(param.activePoolAddress);
        defaultPool = IDefaultPool(param.defaultPoolAddress);
        stabilityPoolAddress = param.stabilityPoolAddress;
        gasPoolAddress = param.gasPoolAddress;
        collSurplusPool = ICollSurplusPool(param.collSurplusPoolAddress);
        priceFeed = IPriceFeed(param.priceFeedAddress);
        sortedTroves = ISortedTroves(param.sortedTrovesAddress);
        lusdToken = ILUSDToken(param.lusdTokenAddress);
        lqtyStakingAddress = param.lqtyStakingAddress;
        lqtyStaking = ILQTYStaking(param.lqtyStakingAddress);
        systemState = ISystemState(param.systemStateAddress);
        oracleRateCalc = IOracleRateCalculation(param.oracleRateCalcAddress);



        emit TroveManagerAddressChanged(param.troveManagerAddress);
        emit ActivePoolAddressChanged(param.activePoolAddress);
        emit DefaultPoolAddressChanged(param.defaultPoolAddress);
        emit StabilityPoolAddressChanged(param.stabilityPoolAddress);
        emit GasPoolAddressChanged(param.gasPoolAddress);
        emit CollSurplusPoolAddressChanged(param.collSurplusPoolAddress);
        emit PriceFeedAddressChanged(param.priceFeedAddress);
        emit SortedTrovesAddressChanged(param.sortedTrovesAddress);
        emit LUSDTokenAddressChanged(param.lusdTokenAddress);
        emit LQTYStakingAddressChanged(param.lqtyStakingAddress);
        emit SystemStateAddressChanged(param.systemStateAddress);
        emit OracleRateCalcAddressChanged(param.oracleRateCalcAddress);

        _renounceOwnership();
    }

    // --- Borrower Trove Operations ---

    function openTrove(
        uint _maxFeePercentage,
        uint _LUSDAmount,
        address _upperHint,
        address _lowerHint,
        bytes[] calldata priceFeedUpdateData
    ) external payable override {
        ContractsCache memory contractsCache = ContractsCache(troveManager, activePool, lusdToken);
        LocalVariables_openTrove memory vars;

        IPriceFeed.FetchPriceResult memory fetchPriceResult = priceFeed.fetchPrice(priceFeedUpdateData);
        vars.price = fetchPriceResult.price;

        // calculate oracleRate
        uint oracleRate = oracleRateCalc.getOracleRate(
            fetchPriceResult.oracleKey, 
            fetchPriceResult.deviationPyth, 
            fetchPriceResult.publishTimePyth
        );

        bool isRecoveryMode = _checkRecoveryMode(vars.price);

        _requireValidMaxFeePercentage(_maxFeePercentage, isRecoveryMode);
        _requireTroveisNotActive(contractsCache.troveManager, msg.sender);

        vars.LUSDFee;
        vars.netDebt = _LUSDAmount;

        TriggerBorrowingFeeParam memory triggerBorrowingFeeParam = TriggerBorrowingFeeParam({
            troveManager: contractsCache.troveManager,
            lusdToken: contractsCache.lusdToken,
            LUSDAmount: _LUSDAmount,
            maxFeePercentage: _maxFeePercentage,
            oracleRate: oracleRate
        });

        if (!isRecoveryMode) {
            vars.LUSDFee = _triggerBorrowingFee(triggerBorrowingFeeParam);
            vars.netDebt = vars.netDebt.add(vars.LUSDFee);
        }
        _requireAtLeastMinNetDebt(vars.netDebt);

        // ICR is based on the composite debt, i.e. the requested LUSD amount + LUSD borrowing fee + LUSD gas comp.
        vars.compositeDebt = _getCompositeDebt(vars.netDebt);
        assert(vars.compositeDebt > 0);

        uint collateral = msg.value;

        vars.ICR = LiquityMath._computeCR(collateral, vars.compositeDebt, vars.price);
        vars.NICR = LiquityMath._computeNominalCR(collateral, vars.compositeDebt);

        if (isRecoveryMode) {
            _requireICRisAboveCCR(vars.ICR);
        } else {
            _requireICRisAboveMCR(vars.ICR);
            uint newTCR = _getNewTCRFromTroveChange(
                collateral,
                true,
                vars.compositeDebt,
                true,
                vars.price
            ); // bools: coll increase, debt increase
            _requireNewTCRisAboveCCR(newTCR);
        }

        {
            // Set the trove struct's properties
            contractsCache.troveManager.setTroveStatus(msg.sender, 1);
            contractsCache.troveManager.increaseTroveColl(msg.sender, collateral);
            contractsCache.troveManager.increaseTroveDebt(msg.sender, vars.compositeDebt);

            contractsCache.troveManager.updateTroveRewardSnapshots(msg.sender);
            vars.stake = contractsCache.troveManager.updateStakeAndTotalStakes(msg.sender);

            ISortedTroves.SortedTrovesInsertParam memory sortedTrovesInsertParam = ISortedTroves.SortedTrovesInsertParam({
                id: msg.sender,
                newNICR: vars.NICR,
                prevId: _upperHint,
                nextId: _lowerHint
            });
            sortedTroves.insert(sortedTrovesInsertParam);
            vars.arrayIndex = contractsCache.troveManager.addTroveOwnerToArray(msg.sender);
            emit TroveCreated(msg.sender, vars.arrayIndex);
        }

        {
            // Move the ether to the Active Pool, and mint the LUSDAmount to the borrower
            _activePoolAddColl(contractsCache.activePool, collateral);
            
            WithdrawLUSDParam memory withdrawParam1 = WithdrawLUSDParam({
                activePool: contractsCache.activePool,
                lusdToken: contractsCache.lusdToken,
                account: msg.sender,
                LUSDAmount: _LUSDAmount,
                netDebtIncrease: vars.netDebt
            });

            _withdrawLUSD(withdrawParam1);
            // Move the LUSD gas compensation to the Gas Pool
            uint LUSD_GAS_COMPENSATION = systemState.getLUSDGasCompensation();

            WithdrawLUSDParam memory withdrawParam2 = WithdrawLUSDParam({
                activePool: contractsCache.activePool,
                lusdToken: contractsCache.lusdToken,
                account: gasPoolAddress,
                LUSDAmount: LUSD_GAS_COMPENSATION,
                netDebtIncrease: LUSD_GAS_COMPENSATION
            });
            _withdrawLUSD(withdrawParam2);

            emit TroveUpdated(
                msg.sender,
                vars.compositeDebt,
                collateral,
                vars.stake,
                BorrowerOperation.openTrove
            );
            emit LUSDBorrowingFeePaid(msg.sender, vars.LUSDFee);
        }
    }

    // Send ETH as collateral to a trove
    function addColl(
        address _upperHint, 
        address _lowerHint,
        bytes[] calldata priceFeedUpdateData
    ) external payable override {
        AdjustTroveParam memory adjustTroveParam = AdjustTroveParam({
            collWithdrawal: 0,
            LUSDChange: 0,
            isDebtIncrease: false,
            upperHint: _upperHint,
            lowerHint: _lowerHint,
            maxFeePercentage: 0
        });
        _adjustTrove(msg.sender, adjustTroveParam, priceFeedUpdateData);
    }

    // Send ETH as collateral to a trove. Called by only the Stability Pool.
    function moveETHGainToTrove(
        address _borrower,
        address _upperHint,
        address _lowerHint,
        bytes[] calldata priceFeedUpdateData
    ) external payable override {
        _requireCallerIsStabilityPool();
        AdjustTroveParam memory adjustTroveParam = AdjustTroveParam({
            collWithdrawal: 0,
            LUSDChange: 0,
            isDebtIncrease: false,
            upperHint: _upperHint,
            lowerHint: _lowerHint,
            maxFeePercentage: 0
        });
        _adjustTrove(_borrower, adjustTroveParam, priceFeedUpdateData);
    }

    // Withdraw ETH collateral from a trove
    function withdrawColl(
        uint _collWithdrawal,
        address _upperHint,
        address _lowerHint,
        bytes[] calldata priceFeedUpdateData
    ) external override {
        AdjustTroveParam memory adjustTroveParam = AdjustTroveParam({
            collWithdrawal: _collWithdrawal,
            LUSDChange: 0,
            isDebtIncrease: false,
            upperHint: _upperHint,
            lowerHint: _lowerHint,
            maxFeePercentage: 0
        });
        _adjustTrove(msg.sender, adjustTroveParam, priceFeedUpdateData);
    }

    // Withdraw LUSD tokens from a trove: mint new LUSD tokens to the owner, and increase the trove's debt accordingly
    function withdrawLUSD(
        uint _maxFeePercentage,
        uint _LUSDAmount,
        address _upperHint,
        address _lowerHint,
        bytes[] calldata priceFeedUpdateData
    ) external override {
        AdjustTroveParam memory adjustTroveParam = AdjustTroveParam({
            collWithdrawal: 0,
            LUSDChange: _LUSDAmount,
            isDebtIncrease: true,
            upperHint: _upperHint,
            lowerHint: _lowerHint,
            maxFeePercentage: _maxFeePercentage
        });
        _adjustTrove(msg.sender, adjustTroveParam, priceFeedUpdateData);
    }

    // Repay LUSD tokens to a Trove: Burn the repaid LUSD tokens, and reduce the trove's debt accordingly
    function repayLUSD(
        uint _LUSDAmount, 
        address _upperHint, 
        address _lowerHint,
        bytes[] calldata priceFeedUpdateData
    ) external override {
        AdjustTroveParam memory adjustTroveParam = AdjustTroveParam({
            collWithdrawal: 0,
            LUSDChange: _LUSDAmount,
            isDebtIncrease: false,
            upperHint: _upperHint,
            lowerHint: _lowerHint,
            maxFeePercentage: 0
        });
        _adjustTrove(msg.sender, adjustTroveParam, priceFeedUpdateData);
    }

    function adjustTrove(
        AdjustTroveParam memory adjustParam,
        bytes[] calldata priceFeedUpdateData
    ) external payable override {
        _adjustTrove(
            msg.sender,
            adjustParam,
            priceFeedUpdateData
        );
    }

    /*
     * _adjustTrove(): Alongside a debt change, this function can perform either a collateral top-up or a collateral withdrawal.
     *
     * It therefore expects either a positive msg.value, or a positive _collWithdrawal argument.
     *
     * If both are positive, it will revert.
     */

    function _adjustTrove(
        address _borrower,
        AdjustTroveParam memory adjustTroveParam,
        bytes[] calldata priceFeedUpdateData
    ) internal {
        ContractsCache memory contractsCache = ContractsCache(troveManager, activePool, lusdToken);
        LocalVariables_adjustTrove memory vars;

        IPriceFeed.FetchPriceResult memory fetchPriceResult = priceFeed.fetchPrice(priceFeedUpdateData);
        vars.price = fetchPriceResult.price;

        // calculate oracleRate
        uint oracleRate = oracleRateCalc.getOracleRate(
            fetchPriceResult.oracleKey, 
            fetchPriceResult.deviationPyth, 
            fetchPriceResult.publishTimePyth
        );

        uint collateral = msg.value;

        bool isRecoveryMode = _checkRecoveryMode(vars.price);

        {
            if (adjustTroveParam.isDebtIncrease) {
                _requireValidMaxFeePercentage(adjustTroveParam.maxFeePercentage, isRecoveryMode);
                _requireNonZeroDebtChange(adjustTroveParam.LUSDChange);
            }
            _requireSingularCollChange(adjustTroveParam.collWithdrawal);
            _requireNonZeroAdjustment(adjustTroveParam.collWithdrawal, adjustTroveParam.LUSDChange);
            
            TroveIsActiveParam memory troveIsActiveParam = TroveIsActiveParam({
                troveManager: contractsCache.troveManager,
                borrower: _borrower
            });
            _requireTroveisActive(troveIsActiveParam);

            // Confirm the operation is either a borrower adjusting their own trove, or a pure ETH transfer from the Stability Pool to a trove
            assert(
                msg.sender == _borrower ||
                    (msg.sender == stabilityPoolAddress && collateral > 0 && adjustTroveParam.LUSDChange == 0)
            );

            contractsCache.troveManager.applyPendingRewards(_borrower);
        }

        {
            // Get the collChange based on whether or not ETH was sent in the transaction
            (vars.collChange, vars.isCollIncrease) = _getCollChange(collateral, adjustTroveParam.collWithdrawal);

            vars.netDebtChange = adjustTroveParam.LUSDChange;

            TriggerBorrowingFeeParam memory triggerBorrowingFeeParam = TriggerBorrowingFeeParam({
                troveManager: contractsCache.troveManager,
                lusdToken: contractsCache.lusdToken,
                LUSDAmount: adjustTroveParam.LUSDChange,
                maxFeePercentage: adjustTroveParam.maxFeePercentage,
                oracleRate: oracleRate
            });

            // If the adjustment incorporates a debt increase and system is in Normal Mode, then trigger a borrowing fee
            if (adjustTroveParam.isDebtIncrease && !isRecoveryMode) {
                vars.LUSDFee = _triggerBorrowingFee(triggerBorrowingFeeParam);
                vars.netDebtChange = vars.netDebtChange.add(vars.LUSDFee); // The raw debt change includes the fee
            }

            vars.debt = contractsCache.troveManager.getTroveDebt(_borrower);
            vars.coll = contractsCache.troveManager.getTroveColl(_borrower);

            // Get the trove's old ICR before the adjustment, and what its new ICR will be after the adjustment
            vars.oldICR = LiquityMath._computeCR(vars.coll, vars.debt, vars.price);

            NewICRFromTroveChangeParam memory newICRParam = NewICRFromTroveChangeParam({
                coll: vars.coll,
                debt: vars.debt,
                collChange: vars.collChange,
                isCollIncrease: vars.isCollIncrease,
                debtChange: vars.netDebtChange,
                isDebtIncrease: adjustTroveParam.isDebtIncrease,
                price: vars.price
            });
            vars.newICR = _getNewICRFromTroveChange(newICRParam);
            assert(adjustTroveParam.collWithdrawal <= vars.coll);

            // Check the adjustment satisfies all conditions for the current system mode
            _requireValidAdjustmentInCurrentMode(isRecoveryMode, adjustTroveParam.collWithdrawal, adjustTroveParam.isDebtIncrease, vars);

            // When the adjustment is a debt repayment, check it's a valid amount and that the caller has enough LUSD
            if (!adjustTroveParam.isDebtIncrease && adjustTroveParam.LUSDChange > 0) {
                _requireAtLeastMinNetDebt(_getNetDebt(vars.debt).sub(vars.netDebtChange));
                _requireValidLUSDRepayment(vars.debt, vars.netDebtChange);
                _requireSufficientLUSDBalance(contractsCache.lusdToken, _borrower, vars.netDebtChange);
            }
        }

        {
            UpdateTroveFromAdjustmentParam memory updateTroveFromAdjustmentParam = UpdateTroveFromAdjustmentParam({
                troveManager: contractsCache.troveManager,
                borrower: _borrower,
                collChange: vars.collChange,
                isCollIncrease: vars.isCollIncrease,
                debtChange: vars.netDebtChange,
                isDebtIncrease: adjustTroveParam.isDebtIncrease
            });

            (vars.newColl, vars.newDebt) = _updateTroveFromAdjustment(updateTroveFromAdjustmentParam);
            vars.stake = contractsCache.troveManager.updateStakeAndTotalStakes(_borrower);
        }

        {
            // Re-insert trove in to the sorted list
            NewNomialICRFromTroveChangeParam memory newNomialICRFromTroveChangeParam = NewNomialICRFromTroveChangeParam({
                coll: vars.coll,
                debt: vars.debt,
                collChange: vars.collChange,
                isCollIncrease: vars.isCollIncrease,
                debtChange: vars.netDebtChange,
                isDebtIncrease: adjustTroveParam.isDebtIncrease
            });
            uint newNICR = _getNewNominalICRFromTroveChange(newNomialICRFromTroveChangeParam);

            ISortedTroves.SortedTrovesInsertParam memory sortedTrovesParam = ISortedTroves.SortedTrovesInsertParam({
                id: _borrower,
                newNICR: newNICR,
                prevId: adjustTroveParam.upperHint,
                nextId: adjustTroveParam.lowerHint
            });
            sortedTroves.reInsert(sortedTrovesParam);
        }

        emit TroveUpdated(
            _borrower,
            vars.newDebt,
            vars.newColl,
            vars.stake,
            BorrowerOperation.adjustTrove
        );
        emit LUSDBorrowingFeePaid(msg.sender, vars.LUSDFee);

        // Use the unmodified _LUSDChange here, as we don't send the fee to the user

        MoveTokensAndETHFromAdjustmentParam memory moveParam = MoveTokensAndETHFromAdjustmentParam({
            activePool: contractsCache.activePool,
            lusdToken: contractsCache.lusdToken,
            borrower: msg.sender,
            collChange: vars.collChange,
            isCollIncrease: vars.isCollIncrease,
            LUSDChange: adjustTroveParam.LUSDChange,
            isDebtIncrease: adjustTroveParam.isDebtIncrease,
            netDebtChange: vars.netDebtChange
        });

        _moveTokensAndETHfromAdjustment(moveParam);
    }

    function closeTrove(bytes[] calldata priceFeedUpdateData) external override {
        ITroveManager troveManagerCached = troveManager;
        IActivePool activePoolCached = activePool;
        ILUSDToken lusdTokenCached = lusdToken;

        TroveIsActiveParam memory troveIsActiveParam = TroveIsActiveParam({
            troveManager: troveManagerCached,
            borrower: msg.sender
        });
        _requireTroveisActive(troveIsActiveParam);
        IPriceFeed.FetchPriceResult memory fetchPriceResult = priceFeed.fetchPrice(priceFeedUpdateData);
        _requireNotInRecoveryMode(fetchPriceResult.price);

        troveManagerCached.applyPendingRewards(msg.sender);

        uint coll = troveManagerCached.getTroveColl(msg.sender);
        uint debt = troveManagerCached.getTroveDebt(msg.sender);

        uint LUSD_GAS_COMPENSATION = systemState.getLUSDGasCompensation();

        _requireSufficientLUSDBalance(lusdTokenCached, msg.sender, debt.sub(LUSD_GAS_COMPENSATION));

        uint newTCR = _getNewTCRFromTroveChange(coll, false, debt, false, fetchPriceResult.price);
        _requireNewTCRisAboveCCR(newTCR);

        troveManagerCached.removeStake(msg.sender);
        troveManagerCached.closeTrove(msg.sender);

        emit TroveUpdated(msg.sender, 0, 0, 0, BorrowerOperation.closeTrove);

        // Burn the repaid LUSD from the user's balance and the gas compensation from the Gas Pool
        _repayLUSD(activePoolCached, lusdTokenCached, msg.sender, debt.sub(LUSD_GAS_COMPENSATION));
        _repayLUSD(activePoolCached, lusdTokenCached, gasPoolAddress, LUSD_GAS_COMPENSATION);

        // Send the collateral back to the user
        activePoolCached.sendETH(msg.sender, coll);
    }

    /**
     * Claim remaining collateral from a redemption or from a liquidation with ICR > MCR in Recovery Mode
     */
    function claimCollateral() external override {
        // send ETH from CollSurplus Pool to owner
        collSurplusPool.claimColl(msg.sender);
    }

    // --- Helper functions ---

    function _triggerBorrowingFee(TriggerBorrowingFeeParam memory param) internal returns (uint) {
        param.troveManager.decayBaseRateFromBorrowing(); // decay the baseRate state variable
        uint LUSDFee = param.troveManager.getBorrowingFee(param.LUSDAmount, param.oracleRate);

        _requireUserAcceptsFee(LUSDFee, param.LUSDAmount, param.maxFeePercentage);

        // Send fee to LQTY staking contract
        lqtyStaking.increaseF_LUSD(LUSDFee);
        param.lusdToken.mint(lqtyStakingAddress, LUSDFee);

        return LUSDFee;
    }

    function _getUSDValue(uint _coll, uint _price) internal pure returns (uint) {
        uint usdValue = _price.mul(_coll).div(DECIMAL_PRECISION);

        return usdValue;
    }

    function _getCollChange(
        uint _collReceived,
        uint _requestedCollWithdrawal
    ) internal pure returns (uint collChange, bool isCollIncrease) {
        if (_collReceived != 0) {
            collChange = _collReceived;
            isCollIncrease = true;
        } else {
            collChange = _requestedCollWithdrawal;
        }
    }

    // Update trove's coll and debt based on whether they increase or decrease
    function _updateTroveFromAdjustment(UpdateTroveFromAdjustmentParam memory param) internal returns (uint, uint) {
        uint newColl = (param.isCollIncrease)
            ? param.troveManager.increaseTroveColl(param.borrower, param.collChange)
            : param.troveManager.decreaseTroveColl(param.borrower, param.collChange);
        uint newDebt = (param.isDebtIncrease)
            ? param.troveManager.increaseTroveDebt(param.borrower, param.debtChange)
            : param.troveManager.decreaseTroveDebt(param.borrower, param.debtChange);

        return (newColl, newDebt);
    }

    function _moveTokensAndETHfromAdjustment(MoveTokensAndETHFromAdjustmentParam memory param) internal {
        if (param.isDebtIncrease) {
            WithdrawLUSDParam memory withdrawParam = WithdrawLUSDParam({
                activePool: param.activePool,
                lusdToken: param.lusdToken,
                account: param.borrower,
                LUSDAmount: param.LUSDChange,
                netDebtIncrease: param.netDebtChange
            });
            _withdrawLUSD(withdrawParam);
        } else {
            _repayLUSD(param.activePool, param.lusdToken, param.borrower, param.LUSDChange);
        }

        if (param.isCollIncrease) {
            _activePoolAddColl(param.activePool, param.collChange);
        } else {
            param.activePool.sendETH(param.borrower, param.collChange);
        }
    }

    // Send ETH to Active Pool and increase its recorded ETH balance
    function _activePoolAddColl(IActivePool _activePool, uint _amount) internal {
        (bool success, ) = address(_activePool).call{value: _amount}("");
        require(success, "BorrowerOps: Sending ETH to ActivePool failed");
    }

    // Issue the specified amount of LUSD to _account and increases the total active debt (_netDebtIncrease potentially includes a LUSDFee)

    function _withdrawLUSD(WithdrawLUSDParam memory param) internal {
        param.activePool.increaseLUSDDebt(param.netDebtIncrease);
        param.lusdToken.mint(param.account, param.LUSDAmount);
    }

    // Burn the specified amount of LUSD from _account and decreases the total active debt
    function _repayLUSD(
        IActivePool _activePool,
        ILUSDToken _lusdToken,
        address _account,
        uint _LUSD
    ) internal {
        _activePool.decreaseLUSDDebt(_LUSD);
        _lusdToken.burn(_account, _LUSD);
    }

    // --- 'Require' wrapper functions ---

    function _requireSingularCollChange(uint _collWithdrawal) internal view {
        require(
            msg.value == 0 || _collWithdrawal == 0,
            "BorrowerOperations: Cannot withdraw and add coll"
        );
    }

    function _requireCallerIsBorrower(address _borrower) internal view {
        require(
            msg.sender == _borrower,
            "BorrowerOps: Caller must be the borrower for a withdrawal"
        );
    }

    function _requireNonZeroAdjustment(uint _collWithdrawal, uint _LUSDChange) internal view {
        require(
            msg.value != 0 || _collWithdrawal != 0 || _LUSDChange != 0,
            "BorrowerOps: There must be either a collateral change or a debt change"
        );
    }

    function _requireTroveisActive(TroveIsActiveParam memory param) internal view {
        uint status = param.troveManager.getTroveStatus(param.borrower);
        require(status == 1, "BorrowerOps: Trove does not exist or is closed");
    }

    function _requireTroveisNotActive(ITroveManager _troveManager, address _borrower) internal view {
        uint status = _troveManager.getTroveStatus(_borrower);
        require(status != 1, "BorrowerOps: Trove is active");
    }

    function _requireNonZeroDebtChange(uint _LUSDChange) internal pure {
        require(_LUSDChange > 0, "BorrowerOps: Debt increase requires non-zero debtChange");
    }

    function _requireNotInRecoveryMode(uint _price) internal view {
        require(
            !_checkRecoveryMode(_price),
            "BorrowerOps: Operation not permitted during Recovery Mode"
        );
    }

    function _requireNoCollWithdrawal(uint _collWithdrawal) internal pure {
        require(
            _collWithdrawal == 0,
            "BorrowerOps: Collateral withdrawal not permitted Recovery Mode"
        );
    }

    function _requireValidAdjustmentInCurrentMode(
        bool _isRecoveryMode,
        uint _collWithdrawal,
        bool _isDebtIncrease,
        LocalVariables_adjustTrove memory _vars
    ) internal view {
        /*
         *In Recovery Mode, only allow:
         *
         * - Pure collateral top-up
         * - Pure debt repayment
         * - Collateral top-up with debt repayment
         * - A debt increase combined with a collateral top-up which makes the ICR >= 150% and improves the ICR (and by extension improves the TCR).
         *
         * In Normal Mode, ensure:
         *
         * - The new ICR is above MCR
         * - The adjustment won't pull the TCR below CCR
         */
        if (_isRecoveryMode) {
            _requireNoCollWithdrawal(_collWithdrawal);
            if (_isDebtIncrease) {
                _requireICRisAboveCCR(_vars.newICR);
                _requireNewICRisAboveOldICR(_vars.newICR, _vars.oldICR);
            }
        } else {
            // if Normal Mode
            _requireICRisAboveMCR(_vars.newICR);
            _vars.newTCR = _getNewTCRFromTroveChange(
                _vars.collChange,
                _vars.isCollIncrease,
                _vars.netDebtChange,
                _isDebtIncrease,
                _vars.price
            );
            _requireNewTCRisAboveCCR(_vars.newTCR);
        }
    }

    function _requireICRisAboveMCR(uint _newICR) internal view {
        uint MCR = systemState.getMCR();
        require(
            _newICR >= MCR,
            "BorrowerOps: An operation that would result in ICR < MCR is not permitted"
        );
    }

    function _requireICRisAboveCCR(uint _newICR) internal view {
        uint CCR = systemState.getCCR();
        require(_newICR >= CCR, "BorrowerOps: Operation must leave trove with ICR >= CCR");
    }

    function _requireNewICRisAboveOldICR(uint _newICR, uint _oldICR) internal pure {
        require(
            _newICR >= _oldICR,
            "BorrowerOps: Cannot decrease your Trove's ICR in Recovery Mode"
        );
    }

    function _requireNewTCRisAboveCCR(uint _newTCR) internal view {
        uint CCR = systemState.getCCR();
        require(
            _newTCR >= CCR,
            "BorrowerOps: An operation that would result in TCR < CCR is not permitted"
        );
    }

    function _requireAtLeastMinNetDebt(uint _netDebt) internal view {
        uint MIN_NET_DEBT = systemState.getMinNetDebt();
        require(
            _netDebt >= MIN_NET_DEBT,
            "BorrowerOps: Trove's net debt must be greater than minimum"
        );
    }

    function _requireValidLUSDRepayment(uint _currentDebt, uint _debtRepayment) internal view {
        uint LUSD_GAS_COMPENSATION = systemState.getLUSDGasCompensation();
        require(
            _debtRepayment <= _currentDebt.sub(LUSD_GAS_COMPENSATION),
            "BorrowerOps: Amount repaid must not be larger than the Trove's debt"
        );
    }

    function _requireCallerIsStabilityPool() internal view {
        require(msg.sender == stabilityPoolAddress, "BorrowerOps: Caller is not Stability Pool");
    }

    function _requireSufficientLUSDBalance(
        ILUSDToken _lusdToken,
        address _borrower,
        uint _debtRepayment
    ) internal view {
        require(
            _lusdToken.balanceOf(_borrower) >= _debtRepayment,
            "BorrowerOps: Caller doesnt have enough LUSD to make repayment"
        );
    }

    function _requireValidMaxFeePercentage(
        uint _maxFeePercentage,
        bool _isRecoveryMode
    ) internal view {
        if (_isRecoveryMode) {
            require(
                _maxFeePercentage <= DECIMAL_PRECISION,
                "Max fee percentage must less than or equal to 100%"
            );
        } else {
            uint BORROWING_FEE_FLOOR = systemState.getBorrowingFeeFloor();
            require(
                _maxFeePercentage >= BORROWING_FEE_FLOOR && _maxFeePercentage <= DECIMAL_PRECISION,
                "Max fee percentage must be between 0.5% and 100%"
            );
        }
    }

    // --- ICR and TCR getters ---

    // Compute the new collateral ratio, considering the change in coll and debt. Assumes 0 pending rewards.
    function _getNewNominalICRFromTroveChange(NewNomialICRFromTroveChangeParam memory param) internal pure returns (uint) {
        (uint newColl, uint newDebt) = _getNewTroveAmounts(
            param.coll,
            param.debt,
            param.collChange,
            param.isCollIncrease,
            param.debtChange,
            param.isDebtIncrease
        );

        uint newNICR = LiquityMath._computeNominalCR(newColl, newDebt);
        return newNICR;
    }

    // Compute the new collateral ratio, considering the change in coll and debt. Assumes 0 pending rewards.
    function _getNewICRFromTroveChange(
        NewICRFromTroveChangeParam memory param
    ) internal pure returns (uint) {
        (uint newColl, uint newDebt) = _getNewTroveAmounts(
            param.coll,
            param.debt,
            param.collChange,
            param.isCollIncrease,
            param.debtChange,
            param.isDebtIncrease
        );

        uint newICR = LiquityMath._computeCR(newColl, newDebt, param.price);
        return newICR;
    }

    function _getNewTroveAmounts(
        uint _coll,
        uint _debt,
        uint _collChange,
        bool _isCollIncrease,
        uint _debtChange,
        bool _isDebtIncrease
    ) internal pure returns (uint, uint) {
        uint newColl = _coll;
        uint newDebt = _debt;

        newColl = _isCollIncrease ? _coll.add(_collChange) : _coll.sub(_collChange);
        newDebt = _isDebtIncrease ? _debt.add(_debtChange) : _debt.sub(_debtChange);

        return (newColl, newDebt);
    }

    function _getNewTCRFromTroveChange(
        uint _collChange,
        bool _isCollIncrease,
        uint _debtChange,
        bool _isDebtIncrease,
        uint _price
    ) internal view returns (uint) {
        uint totalColl = getEntireSystemColl();
        uint totalDebt = getEntireSystemDebt();

        totalColl = _isCollIncrease ? totalColl.add(_collChange) : totalColl.sub(_collChange);
        totalDebt = _isDebtIncrease ? totalDebt.add(_debtChange) : totalDebt.sub(_debtChange);

        uint newTCR = LiquityMath._computeCR(totalColl, totalDebt, _price);
        return newTCR;
    }

    function getCompositeDebt(uint _debt) external view override returns (uint) {
        return _getCompositeDebt(_debt);
    }
}
