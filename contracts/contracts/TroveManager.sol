// SPDX-License-Identifier: MIT

pragma solidity 0.6.11;
pragma experimental ABIEncoderV2;

import "./Interfaces/ITroveManager.sol";

contract TroveManager is LiquityBase, CheckContract, Ownable, ITroveManager {
    // --- Connected contract declarations ---

    address public borrowerOperationsAddress;

    IStabilityPool public override stabilityPool;

    address gasPoolAddress;

    ICollSurplusPool collSurplusPool;

    IUSDSToken public override usdsToken;

    ISABLEToken public override sableToken;

    ISableStakingV2 public override sableStaking;

    // A doubly linked list of Troves, sorted by their sorted by their collateral ratios
    ISortedTroves public sortedTroves;

    // Oracle rate calculation contract
    IOracleRateCalculation public override oracleRateCalc;

    ITroveHelper public troveHelper;

    // --- Data structures ---

    uint public constant SECONDS_IN_ONE_MINUTE = 60;

    /*
     * Half-life of 12h. 12h = 720 min
     * (1/2) = d^720 => d = (1/2)^(1/720)
     */
    uint public constant MINUTE_DECAY_FACTOR = 999037758833783000;
    uint public constant MAX_BORROWING_FEE = (DECIMAL_PRECISION / 100) * 5; // 5%

    // During bootsrap period redemptions are not allowed
    uint public constant BOOTSTRAP_PERIOD = 0 days;

    /*
     * BETA: 18 digit decimal. Parameter by which to divide the redeemed fraction, in order to calc the new base rate from a redemption.
     * Corresponds to (1 / ALPHA) in the white paper.
     */
    uint public constant BETA = 2;

    uint public baseRate;

    // The timestamp of the latest fee operation (redemption or new USDS issuance)
    uint public lastFeeOperationTime;

    mapping(address => Trove) public Troves;

    uint public totalStakes;

    // Snapshot of the value of totalStakes, taken immediately after the latest liquidation
    uint public totalStakesSnapshot;

    // Snapshot of the total collateral across the ActivePool and DefaultPool, immediately after the latest liquidation.
    uint public totalCollateralSnapshot;

    /*
     * L_BNB and L_USDSDebt track the sums of accumulated liquidation rewards per unit staked. During its lifetime, each stake earns:
     *
     * An BNB gain of ( stake * [L_BNB - L_BNB(0)] )
     * A USDSDebt increase  of ( stake * [L_USDSDebt - L_USDSDebt(0)] )
     *
     * Where L_BNB(0) and L_USDSDebt(0) are snapshots of L_BNB and L_USDSDebt for the active Trove taken at the instant the stake was made
     */
    uint public L_BNB;
    uint public L_USDSDebt;

    // Map addresses with active troves to their RewardSnapshot
    mapping(address => RewardSnapshot) public rewardSnapshots;

    // Array of all active trove addresses - used to to compute an approximate hint off-chain, for the sorted list insertion
    address[] public TroveOwners;

    // Error trackers for the trove redistribution calculation
    uint public lastBNBError_Redistribution;
    uint public lastUSDSDebtError_Redistribution;

    // --- Dependency setter ---

    function setAddresses(DependencyAddressParam memory param) external override onlyOwner {

        checkContract(param.borrowerOperationsAddress);
        checkContract(param.activePoolAddress);
        checkContract(param.defaultPoolAddress);
        checkContract(param.stabilityPoolAddress);
        checkContract(param.gasPoolAddress);
        checkContract(param.collSurplusPoolAddress);
        checkContract(param.priceFeedAddress);
        checkContract(param.usdsTokenAddress);
        checkContract(param.sortedTrovesAddress);
        checkContract(param.sableTokenAddress);
        checkContract(param.sableStakingAddress);
        checkContract(param.systemStateAddress);
        checkContract(param.oracleRateCalcAddress);
        checkContract(param.troveHelperAddress);

        borrowerOperationsAddress = param.borrowerOperationsAddress;
        activePool = IActivePool(param.activePoolAddress);
        defaultPool = IDefaultPool(param.defaultPoolAddress);
        stabilityPool = IStabilityPool(param.stabilityPoolAddress);
        gasPoolAddress = param.gasPoolAddress;
        collSurplusPool = ICollSurplusPool(param.collSurplusPoolAddress);
        priceFeed = IPriceFeed(param.priceFeedAddress);
        usdsToken = IUSDSToken(param.usdsTokenAddress);
        sortedTroves = ISortedTroves(param.sortedTrovesAddress);
        sableToken = ISABLEToken(param.sableTokenAddress);
        sableStaking = ISableStakingV2(param.sableStakingAddress);
        systemState = ISystemState(param.systemStateAddress);
        oracleRateCalc = IOracleRateCalculation(param.oracleRateCalcAddress);
        troveHelper = ITroveHelper(param.troveHelperAddress);

        emit AddressesChanged(param);

        _renounceOwnership();
    }

    // --- Getters ---

    function getTroveOwnersCount() external view override returns (uint) {
        return TroveOwners.length;
    }

    function getTroveFromTroveOwnersArray(uint _index) external view override returns (address) {
        return TroveOwners[_index];
    }

    // --- Trove Liquidation functions ---

    // Single liquidation function. Closes the trove if its ICR is lower than the minimum collateral ratio.
    function liquidate(
        address _borrower,
        bytes[] calldata priceFeedUpdateData
    ) external override {
        _requireTroveIsActive(_borrower);

        address[] memory borrowers = new address[](1);
        borrowers[0] = _borrower;
        batchLiquidateTroves(borrowers, priceFeedUpdateData);
    }

    // --- Inner single liquidation functions ---

    // Liquidate one trove, in Normal Mode.
    function _liquidateNormalMode(
        IActivePool _activePool,
        IDefaultPool _defaultPool,
        address _borrower,
        uint _USDSInStabPool
    ) internal returns (LiquidationValues memory singleLiquidation) {
        LocalVariables_InnerSingleLiquidateFunction memory vars;

        (
            singleLiquidation.entireTroveDebt,
            singleLiquidation.entireTroveColl,
            vars.pendingDebtReward,
            vars.pendingCollReward
        ) = getEntireDebtAndColl(_borrower);

        _movePendingTroveRewardsToActivePool(
            _activePool,
            _defaultPool,
            vars.pendingDebtReward,
            vars.pendingCollReward
        );
        _removeStake(_borrower);

        singleLiquidation.collGasCompensation = _getCollGasCompensation(
            singleLiquidation.entireTroveColl
        );
        singleLiquidation.USDSGasCompensation = systemState.getUSDSGasCompensation();
        uint collToLiquidate = singleLiquidation.entireTroveColl.sub(
            singleLiquidation.collGasCompensation
        );

        (
            singleLiquidation.debtToOffset,
            singleLiquidation.collToSendToSP,
            singleLiquidation.debtToRedistribute,
            singleLiquidation.collToRedistribute
        ) = _getOffsetAndRedistributionVals(
            singleLiquidation.entireTroveDebt,
            collToLiquidate,
            _USDSInStabPool
        );

        _closeTrove(_borrower, Status.closedByLiquidation);
        emit TroveLiquidated(
            _borrower,
            singleLiquidation.entireTroveDebt,
            singleLiquidation.entireTroveColl,
            TroveManagerOperation.liquidateInNormalMode
        );
        emit TroveUpdated(_borrower, 0, 0, 0, TroveManagerOperation.liquidateInNormalMode);
        return singleLiquidation;
    }

    // Liquidate one trove, in Recovery Mode.
    function _liquidateRecoveryMode(
        IActivePool _activePool,
        IDefaultPool _defaultPool,
        address _borrower,
        uint _ICR,
        uint _USDSInStabPool,
        uint _TCR,
        uint _price
    ) internal returns (LiquidationValues memory singleLiquidation) {
        LocalVariables_InnerSingleLiquidateFunction memory vars;
        if (TroveOwners.length <= 1) {
            return singleLiquidation;
        } // don't liquidate if last trove
        (
            singleLiquidation.entireTroveDebt,
            singleLiquidation.entireTroveColl,
            vars.pendingDebtReward,
            vars.pendingCollReward
        ) = getEntireDebtAndColl(_borrower);

        singleLiquidation.collGasCompensation = _getCollGasCompensation(
            singleLiquidation.entireTroveColl
        );
        uint MCR = systemState.getMCR();

        singleLiquidation.USDSGasCompensation = systemState.getUSDSGasCompensation();
        vars.collToLiquidate = singleLiquidation.entireTroveColl.sub(
            singleLiquidation.collGasCompensation
        );

        // If ICR <= 100%, purely redistribute the Trove across all active Troves
        if (_ICR <= _100pct) {
            _movePendingTroveRewardsToActivePool(
                _activePool,
                _defaultPool,
                vars.pendingDebtReward,
                vars.pendingCollReward
            );
            _removeStake(_borrower);

            singleLiquidation.debtToOffset = 0;
            singleLiquidation.collToSendToSP = 0;
            singleLiquidation.debtToRedistribute = singleLiquidation.entireTroveDebt;
            singleLiquidation.collToRedistribute = vars.collToLiquidate;

            _closeTrove(_borrower, Status.closedByLiquidation);
            emit TroveLiquidated(
                _borrower,
                singleLiquidation.entireTroveDebt,
                singleLiquidation.entireTroveColl,
                TroveManagerOperation.liquidateInRecoveryMode
            );
            emit TroveUpdated(_borrower, 0, 0, 0, TroveManagerOperation.liquidateInRecoveryMode);

            // If 100% < ICR < MCR, offset as much as possible, and redistribute the remainder
        } else if ((_ICR > _100pct) && (_ICR < MCR)) {
            _movePendingTroveRewardsToActivePool(
                _activePool,
                _defaultPool,
                vars.pendingDebtReward,
                vars.pendingCollReward
            );
            _removeStake(_borrower);

            (
                singleLiquidation.debtToOffset,
                singleLiquidation.collToSendToSP,
                singleLiquidation.debtToRedistribute,
                singleLiquidation.collToRedistribute
            ) = _getOffsetAndRedistributionVals(
                singleLiquidation.entireTroveDebt,
                vars.collToLiquidate,
                _USDSInStabPool
            );

            _closeTrove(_borrower, Status.closedByLiquidation);
            emit TroveLiquidated(
                _borrower,
                singleLiquidation.entireTroveDebt,
                singleLiquidation.entireTroveColl,
                TroveManagerOperation.liquidateInRecoveryMode
            );
            emit TroveUpdated(_borrower, 0, 0, 0, TroveManagerOperation.liquidateInRecoveryMode);
            /*
             * If 110% <= ICR < current TCR (accounting for the preceding liquidations in the current sequence)
             * and there is USDS in the Stability Pool, only offset, with no redistribution,
             * but at a capped rate of 1.1 and only if the whole debt can be liquidated.
             * The remainder due to the capped rate will be claimable as collateral surplus.
             */
        } else if (
            (_ICR >= MCR) && (_ICR < _TCR) && (singleLiquidation.entireTroveDebt <= _USDSInStabPool)
        ) {
            _movePendingTroveRewardsToActivePool(
                _activePool,
                _defaultPool,
                vars.pendingDebtReward,
                vars.pendingCollReward
            );
            assert(_USDSInStabPool != 0);

            _removeStake(_borrower);

            singleLiquidation = troveHelper.getCappedOffsetVals(
                singleLiquidation.entireTroveDebt,
                singleLiquidation.entireTroveColl,
                _price
            );

            _closeTrove(_borrower, Status.closedByLiquidation);
            if (singleLiquidation.collSurplus > 0) {
                collSurplusPool.accountSurplus(_borrower, singleLiquidation.collSurplus);
            }

            emit TroveLiquidated(
                _borrower,
                singleLiquidation.entireTroveDebt,
                singleLiquidation.collToSendToSP,
                TroveManagerOperation.liquidateInRecoveryMode
            );
            emit TroveUpdated(_borrower, 0, 0, 0, TroveManagerOperation.liquidateInRecoveryMode);
        } else {
            // if (_ICR >= MCR && ( _ICR >= _TCR || singleLiquidation.entireTroveDebt > _USDSInStabPool))
            LiquidationValues memory zeroVals;
            return zeroVals;
        }

        return singleLiquidation;
    }

    /* In a full liquidation, returns the values for a trove's coll and debt to be offset, and coll and debt to be
     * redistributed to active troves.
     */
    function _getOffsetAndRedistributionVals(
        uint _debt,
        uint _coll,
        uint _USDSInStabPool
    )
        internal
        pure
        returns (
            uint debtToOffset,
            uint collToSendToSP,
            uint debtToRedistribute,
            uint collToRedistribute
        )
    {
        if (_USDSInStabPool > 0) {
            /*
             * Offset as much debt & collateral as possible against the Stability Pool, and redistribute the remainder
             * between all active troves.
             *
             *  If the trove's debt is larger than the deposited USDS in the Stability Pool:
             *
             *  - Offset an amount of the trove's debt equal to the USDS in the Stability Pool
             *  - Send a fraction of the trove's collateral to the Stability Pool, equal to the fraction of its offset debt
             *
             */
            debtToOffset = LiquityMath._min(_debt, _USDSInStabPool);
            collToSendToSP = _coll.mul(debtToOffset).div(_debt);
            debtToRedistribute = _debt.sub(debtToOffset);
            collToRedistribute = _coll.sub(collToSendToSP);
        } else {
            debtToOffset = 0;
            collToSendToSP = 0;
            debtToRedistribute = _debt;
            collToRedistribute = _coll;
        }
    }

    /*
     * Liquidate a sequence of troves. Closes a maximum number of n under-collateralized Troves,
     * starting from the one with the lowest collateral ratio in the system, and moving upwards
     */
    function liquidateTroves(
        uint _n,
        bytes[] calldata priceFeedUpdateData
    ) external override {
        ContractsCache memory contractsCache = ContractsCache(
            activePool,
            defaultPool,
            IUSDSToken(address(0)),
            ISableStakingV2(address(0)),
            sortedTroves,
            ICollSurplusPool(address(0)),
            address(0)
        );
        IStabilityPool stabilityPoolCached = stabilityPool;

        LocalVariables_OuterLiquidationFunction memory vars;

        LiquidationTotals memory totals;

        IPriceFeed.FetchPriceResult memory fetchPriceResult = priceFeed.fetchPrice(
            priceFeedUpdateData
        );
        vars.price = fetchPriceResult.price;

        vars.USDSInStabPool = stabilityPoolCached.getTotalUSDSDeposits();
        vars.recoveryModeAtStart = _checkRecoveryMode(vars.price);

        // Perform the appropriate liquidation sequence - tally the values, and obtain their totals
        if (vars.recoveryModeAtStart) {
            totals = _getTotalsFromLiquidateTrovesSequence_RecoveryMode(
                contractsCache,
                vars.price,
                vars.USDSInStabPool,
                _n
            );
        } else {
            // if !vars.recoveryModeAtStart
            totals = _getTotalsFromLiquidateTrovesSequence_NormalMode(
                contractsCache.activePool,
                contractsCache.defaultPool,
                vars.price,
                vars.USDSInStabPool,
                _n
            );
        }

        // require(totals.totalDebtInSequence > 0, "1");
        assert(totals.totalDebtInSequence > 0);

        // Move liquidated BNB and USDS to the appropriate pools
        stabilityPoolCached.offset(totals.totalDebtToOffset, totals.totalCollToSendToSP);
        _redistributeDebtAndColl(
            contractsCache.activePool,
            contractsCache.defaultPool,
            totals.totalDebtToRedistribute,
            totals.totalCollToRedistribute
        );
        if (totals.totalCollSurplus > 0) {
            contractsCache.activePool.sendBNB(address(collSurplusPool), totals.totalCollSurplus);
        }

        // Update system snapshots
        _updateSystemSnapshots_excludeCollRemainder(
            contractsCache.activePool,
            totals.totalCollGasCompensation
        );

        vars.liquidatedDebt = totals.totalDebtInSequence;
        vars.liquidatedColl = totals.totalCollInSequence.sub(totals.totalCollGasCompensation).sub(
            totals.totalCollSurplus
        );
        emit Liquidation(
            vars.liquidatedDebt,
            vars.liquidatedColl,
            totals.totalCollGasCompensation,
            totals.totalUSDSGasCompensation
        );
        // Send gas compensation to caller
        _sendGasCompensation(
            contractsCache.activePool,
            msg.sender,
            totals.totalUSDSGasCompensation,
            totals.totalCollGasCompensation
        );
    }

    /*
     * This function is used when the liquidateTroves sequence starts during Recovery Mode. However, it
     * handle the case where the system *leaves* Recovery Mode, part way through the liquidation sequence
     */
    function _getTotalsFromLiquidateTrovesSequence_RecoveryMode(
        ContractsCache memory _contractsCache,
        uint _price,
        uint _USDSInStabPool,
        uint _n
    ) internal returns (LiquidationTotals memory totals) {
        LocalVariables_LiquidationSequence memory vars;
        LiquidationValues memory singleLiquidation;

        vars.remainingUSDSInStabPool = _USDSInStabPool;
        vars.backToNormalMode = false;
        vars.entireSystemDebt = getEntireSystemDebt();
        vars.entireSystemColl = getEntireSystemColl();

        vars.user = _contractsCache.sortedTroves.getLast();
        vars.firstUser = _contractsCache.sortedTroves.getFirst();
        vars.MCR = systemState.getMCR();
        for (vars.i = 0; vars.i < _n && vars.user != vars.firstUser; vars.i++) {
            // we need to cache it, because current user is likely going to be deleted
            address nextUser = _contractsCache.sortedTroves.getPrev(vars.user);

            vars.ICR = getCurrentICR(vars.user, _price);
            if (!vars.backToNormalMode) {
                // Break the loop if ICR is greater than MCR and Stability Pool is empty
                if (vars.ICR >= vars.MCR && vars.remainingUSDSInStabPool == 0) {
                    break;
                }

                uint TCR = LiquityMath._computeCR(
                    vars.entireSystemColl,
                    vars.entireSystemDebt,
                    _price
                );

                singleLiquidation = _liquidateRecoveryMode(
                    _contractsCache.activePool,
                    _contractsCache.defaultPool,
                    vars.user,
                    vars.ICR,
                    vars.remainingUSDSInStabPool,
                    TCR,
                    _price
                );

                // Update aggregate trackers
                vars.remainingUSDSInStabPool = vars.remainingUSDSInStabPool.sub(
                    singleLiquidation.debtToOffset
                );
                vars.entireSystemDebt = vars.entireSystemDebt.sub(singleLiquidation.debtToOffset);
                vars.entireSystemColl = vars
                    .entireSystemColl
                    .sub(singleLiquidation.collToSendToSP)
                    .sub(singleLiquidation.collGasCompensation)
                    .sub(singleLiquidation.collSurplus);

                // Add liquidation values to their respective running totals
                totals = _addLiquidationValuesToTotals(totals, singleLiquidation);

                vars.backToNormalMode = !_checkPotentialRecoveryMode(
                    vars.entireSystemColl,
                    vars.entireSystemDebt,
                    _price
                );
            } else if (vars.backToNormalMode && vars.ICR < vars.MCR) {
                singleLiquidation = _liquidateNormalMode(
                    _contractsCache.activePool,
                    _contractsCache.defaultPool,
                    vars.user,
                    vars.remainingUSDSInStabPool
                );

                vars.remainingUSDSInStabPool = vars.remainingUSDSInStabPool.sub(
                    singleLiquidation.debtToOffset
                );

                // Add liquidation values to their respective running totals
                totals = _addLiquidationValuesToTotals(totals, singleLiquidation);
            } else break; // break if the loop reaches a Trove with ICR >= MCR

            vars.user = nextUser;
        }
    }

    function _getTotalsFromLiquidateTrovesSequence_NormalMode(
        IActivePool _activePool,
        IDefaultPool _defaultPool,
        uint _price,
        uint _USDSInStabPool,
        uint _n
    ) internal returns (LiquidationTotals memory totals) {
        LocalVariables_LiquidationSequence memory vars;
        LiquidationValues memory singleLiquidation;
        ISortedTroves sortedTrovesCached = sortedTroves;

        vars.remainingUSDSInStabPool = _USDSInStabPool;
        uint MCR = systemState.getMCR();
        for (vars.i = 0; vars.i < _n; vars.i++) {
            vars.user = sortedTrovesCached.getLast();
            vars.ICR = getCurrentICR(vars.user, _price);

            if (vars.ICR < MCR) {
                singleLiquidation = _liquidateNormalMode(
                    _activePool,
                    _defaultPool,
                    vars.user,
                    vars.remainingUSDSInStabPool
                );

                vars.remainingUSDSInStabPool = vars.remainingUSDSInStabPool.sub(
                    singleLiquidation.debtToOffset
                );

                // Add liquidation values to their respective running totals
                totals = _addLiquidationValuesToTotals(totals, singleLiquidation);
            } else break; // break if the loop reaches a Trove with ICR >= MCR
        }
    }

    /*
     * Attempt to liquidate a custom list of troves provided by the caller.
     */
    function batchLiquidateTroves(
        address[] memory _troveArray,
        bytes[] calldata priceFeedUpdateData
    ) public override {
        require(_troveArray.length != 0, "2");

        IActivePool activePoolCached = activePool;
        IDefaultPool defaultPoolCached = defaultPool;
        IStabilityPool stabilityPoolCached = stabilityPool;

        LocalVariables_OuterLiquidationFunction memory vars;
        LiquidationTotals memory totals;

        IPriceFeed.FetchPriceResult memory fetchPriceResult = priceFeed.fetchPrice(
            priceFeedUpdateData
        );
        vars.price = fetchPriceResult.price;

        vars.USDSInStabPool = stabilityPoolCached.getTotalUSDSDeposits();
        vars.recoveryModeAtStart = _checkRecoveryMode(vars.price);

        // Perform the appropriate liquidation sequence - tally values and obtain their totals.
        if (vars.recoveryModeAtStart) {
            totals = _getTotalFromBatchLiquidate_RecoveryMode(
                activePoolCached,
                defaultPoolCached,
                vars.price,
                vars.USDSInStabPool,
                _troveArray
            );
        } else {
            //  if !vars.recoveryModeAtStart
            totals = _getTotalsFromBatchLiquidate_NormalMode(
                activePoolCached,
                defaultPoolCached,
                vars.price,
                vars.USDSInStabPool,
                _troveArray
            );
        }

        require(totals.totalDebtInSequence > 0, "3");

        // Move liquidated BNB and USDS to the appropriate pools
        stabilityPoolCached.offset(totals.totalDebtToOffset, totals.totalCollToSendToSP);
        _redistributeDebtAndColl(
            activePoolCached,
            defaultPoolCached,
            totals.totalDebtToRedistribute,
            totals.totalCollToRedistribute
        );
        if (totals.totalCollSurplus > 0) {
            activePoolCached.sendBNB(address(collSurplusPool), totals.totalCollSurplus);
        }

        // Update system snapshots
        _updateSystemSnapshots_excludeCollRemainder(
            activePoolCached,
            totals.totalCollGasCompensation
        );

        vars.liquidatedDebt = totals.totalDebtInSequence;
        vars.liquidatedColl = totals.totalCollInSequence.sub(totals.totalCollGasCompensation).sub(
            totals.totalCollSurplus
        );
        emit Liquidation(
            vars.liquidatedDebt,
            vars.liquidatedColl,
            totals.totalCollGasCompensation,
            totals.totalUSDSGasCompensation
        );

        // Send gas compensation to caller
        _sendGasCompensation(
            activePoolCached,
            msg.sender,
            totals.totalUSDSGasCompensation,
            totals.totalCollGasCompensation
        );
    }

    /*
     * This function is used when the batch liquidation sequence starts during Recovery Mode. However, it
     * handle the case where the system *leaves* Recovery Mode, part way through the liquidation sequence
     */
    function _getTotalFromBatchLiquidate_RecoveryMode(
        IActivePool _activePool,
        IDefaultPool _defaultPool,
        uint _price,
        uint _USDSInStabPool,
        address[] memory _troveArray
    ) internal returns (LiquidationTotals memory totals) {
        LocalVariables_LiquidationSequence memory vars;
        LiquidationValues memory singleLiquidation;

        vars.remainingUSDSInStabPool = _USDSInStabPool;
        vars.backToNormalMode = false;
        vars.entireSystemDebt = getEntireSystemDebt();
        vars.entireSystemColl = getEntireSystemColl();
        uint MCR = systemState.getMCR();

        for (vars.i = 0; vars.i < _troveArray.length; vars.i++) {
            vars.user = _troveArray[vars.i];
            // Skip non-active troves
            if (Troves[vars.user].status != Status.active) {
                continue;
            }
            vars.ICR = getCurrentICR(vars.user, _price);

            if (!vars.backToNormalMode) {
                // Skip this trove if ICR is greater than MCR and Stability Pool is empty
                if (vars.ICR >= MCR && vars.remainingUSDSInStabPool == 0) {
                    continue;
                }

                uint TCR = LiquityMath._computeCR(
                    vars.entireSystemColl,
                    vars.entireSystemDebt,
                    _price
                );

                singleLiquidation = _liquidateRecoveryMode(
                    _activePool,
                    _defaultPool,
                    vars.user,
                    vars.ICR,
                    vars.remainingUSDSInStabPool,
                    TCR,
                    _price
                );

                // Update aggregate trackers
                vars.remainingUSDSInStabPool = vars.remainingUSDSInStabPool.sub(
                    singleLiquidation.debtToOffset
                );
                vars.entireSystemDebt = vars.entireSystemDebt.sub(singleLiquidation.debtToOffset);
                vars.entireSystemColl = vars
                    .entireSystemColl
                    .sub(singleLiquidation.collToSendToSP)
                    .sub(singleLiquidation.collGasCompensation)
                    .sub(singleLiquidation.collSurplus);

                // Add liquidation values to their respective running totals
                totals = _addLiquidationValuesToTotals(totals, singleLiquidation);

                vars.backToNormalMode = !_checkPotentialRecoveryMode(
                    vars.entireSystemColl,
                    vars.entireSystemDebt,
                    _price
                );
            } else if (vars.backToNormalMode && vars.ICR < MCR) {
                singleLiquidation = _liquidateNormalMode(
                    _activePool,
                    _defaultPool,
                    vars.user,
                    vars.remainingUSDSInStabPool
                );
                vars.remainingUSDSInStabPool = vars.remainingUSDSInStabPool.sub(
                    singleLiquidation.debtToOffset
                );

                // Add liquidation values to their respective running totals
                totals = _addLiquidationValuesToTotals(totals, singleLiquidation);
            } else continue; // In Normal Mode skip troves with ICR >= MCR
        }
    }

    function _getTotalsFromBatchLiquidate_NormalMode(
        IActivePool _activePool,
        IDefaultPool _defaultPool,
        uint _price,
        uint _USDSInStabPool,
        address[] memory _troveArray
    ) internal returns (LiquidationTotals memory totals) {
        LocalVariables_LiquidationSequence memory vars;
        LiquidationValues memory singleLiquidation;

        vars.remainingUSDSInStabPool = _USDSInStabPool;
        uint MCR = systemState.getMCR();

        for (vars.i = 0; vars.i < _troveArray.length; vars.i++) {
            vars.user = _troveArray[vars.i];
            vars.ICR = getCurrentICR(vars.user, _price);

            if (vars.ICR < MCR) {
                singleLiquidation = _liquidateNormalMode(
                    _activePool,
                    _defaultPool,
                    vars.user,
                    vars.remainingUSDSInStabPool
                );
                vars.remainingUSDSInStabPool = vars.remainingUSDSInStabPool.sub(
                    singleLiquidation.debtToOffset
                );

                // Add liquidation values to their respective running totals
                totals = _addLiquidationValuesToTotals(totals, singleLiquidation);
            }
        }
    }

    // --- Liquidation helper functions ---

    function _addLiquidationValuesToTotals(
        LiquidationTotals memory oldTotals,
        LiquidationValues memory singleLiquidation
    ) internal pure returns (LiquidationTotals memory newTotals) {
        // Tally all the values with their respective running totals
        newTotals.totalCollGasCompensation = oldTotals.totalCollGasCompensation.add(
            singleLiquidation.collGasCompensation
        );
        newTotals.totalUSDSGasCompensation = oldTotals.totalUSDSGasCompensation.add(
            singleLiquidation.USDSGasCompensation
        );
        newTotals.totalDebtInSequence = oldTotals.totalDebtInSequence.add(
            singleLiquidation.entireTroveDebt
        );
        newTotals.totalCollInSequence = oldTotals.totalCollInSequence.add(
            singleLiquidation.entireTroveColl
        );
        newTotals.totalDebtToOffset = oldTotals.totalDebtToOffset.add(
            singleLiquidation.debtToOffset
        );
        newTotals.totalCollToSendToSP = oldTotals.totalCollToSendToSP.add(
            singleLiquidation.collToSendToSP
        );
        newTotals.totalDebtToRedistribute = oldTotals.totalDebtToRedistribute.add(
            singleLiquidation.debtToRedistribute
        );
        newTotals.totalCollToRedistribute = oldTotals.totalCollToRedistribute.add(
            singleLiquidation.collToRedistribute
        );
        newTotals.totalCollSurplus = oldTotals.totalCollSurplus.add(singleLiquidation.collSurplus);

        return newTotals;
    }

    function _sendGasCompensation(
        IActivePool _activePool,
        address _liquidator,
        uint _USDS,
        uint _BNB
    ) internal {
        if (_USDS > 0) {
            usdsToken.returnFromPool(gasPoolAddress, _liquidator, _USDS);
        }

        if (_BNB > 0) {
            _activePool.sendBNB(_liquidator, _BNB);
        }
    }

    // Move a Trove's pending debt and collateral rewards from distributions, from the Default Pool to the Active Pool
    function _movePendingTroveRewardsToActivePool(
        IActivePool _activePool,
        IDefaultPool _defaultPool,
        uint _USDS,
        uint _BNB
    ) internal {
        _defaultPool.decreaseUSDSDebt(_USDS);
        _activePool.increaseUSDSDebt(_USDS);
        _defaultPool.sendBNBToActivePool(_BNB);
    }

    // --- Redemption functions ---

    // Redeem as much collateral as possible from _borrower's Trove in exchange for USDS up to _maxUSDSamount
    function _redeemCollateralFromTrove(
        RedeemCollateralFromTroveParam memory param
    ) internal returns (SingleRedemptionValues memory singleRedemption) {
        // Determine the remaining amount (lot) to be redeemed, capped by the entire debt of the Trove minus the liquidation reserve
        LocalVariables_RedeemCollateralFromTrove memory v;

        v.usdsGasCompensation = systemState.getUSDSGasCompensation();

        v.minNetDebt = systemState.getMinNetDebt();

        singleRedemption.USDSLot = LiquityMath._min(
            param.maxUSDSamount,
            Troves[param.borrower].debt.sub(v.usdsGasCompensation)
        );

        // Get the BNBLot of equivalent value in USD
        singleRedemption.BNBLot = singleRedemption.USDSLot.mul(DECIMAL_PRECISION).div(param.price);

        // Decrease the debt and collateral of the current Trove according to the USDS lot and corresponding BNB to send
        v.newDebt = (Troves[param.borrower].debt).sub(singleRedemption.USDSLot);

        v.newColl = (Troves[param.borrower].coll).sub(singleRedemption.BNBLot);

        if (v.newDebt == v.usdsGasCompensation) {
            // No debt left in the Trove (except for the liquidation reserve), therefore the trove gets closed
            _removeStake(param.borrower);
            _closeTrove(param.borrower, Status.closedByRedemption);
            _redeemCloseTrove(param.contractsCache, param.borrower, v.usdsGasCompensation, v.newColl);
            emit TroveUpdated(param.borrower, 0, 0, 0, TroveManagerOperation.redeemCollateral);
        } else {
            uint newNICR = LiquityMath._computeNominalCR(v.newColl, v.newDebt);

            /*
             * If the provided hint is out of date, we bail since trying to reinsert without a good hint will almost
             * certainly result in running out of gas.
             *
             * If the resultant net debt of the partial is less than the minimum, net debt we bail.
             */
            if (newNICR != param.partialRedemptionHintNICR || _getNetDebt(v.newDebt) < v.minNetDebt) {
                singleRedemption.cancelledPartial = true;
                return singleRedemption;
            }

            ISortedTroves.SortedTrovesInsertParam memory sortedTrovesParam = ISortedTroves
                .SortedTrovesInsertParam({
                    id: param.borrower,
                    newNICR: newNICR,
                    prevId: param.upperPartialRedemptionHint,
                    nextId: param.lowerPartialRedemptionHint
                });

            param.contractsCache.sortedTroves.reInsert(sortedTrovesParam);

            Troves[param.borrower].debt = v.newDebt;
            Troves[param.borrower].coll = v.newColl;
            _updateStakeAndTotalStakes(param.borrower);

            emit TroveUpdated(
                param.borrower,
                v.newDebt,
                v.newColl,
                Troves[param.borrower].stake,
                TroveManagerOperation.redeemCollateral
            );
        }

        return singleRedemption;
    }

    /*
     * Called when a full redemption occurs, and closes the trove.
     * The redeemer swaps (debt - liquidation reserve) USDS for (debt - liquidation reserve) worth of BNB, so the USDS liquidation reserve left corresponds to the remaining debt.
     * In order to close the trove, the USDS liquidation reserve is burned, and the corresponding debt is removed from the active pool.
     * The debt recorded on the trove's struct is zero'd elswhere, in _closeTrove.
     * Any surplus BNB left in the trove, is sent to the Coll surplus pool, and can be later claimed by the borrower.
     */
    function _redeemCloseTrove(
        ContractsCache memory _contractsCache,
        address _borrower,
        uint _USDS,
        uint _BNB
    ) internal {
        _contractsCache.usdsToken.burn(gasPoolAddress, _USDS);
        // Update Active Pool USDS, and send BNB to account
        _contractsCache.activePool.decreaseUSDSDebt(_USDS);

        // send BNB from Active Pool to CollSurplus Pool
        _contractsCache.collSurplusPool.accountSurplus(_borrower, _BNB);
        _contractsCache.activePool.sendBNB(address(_contractsCache.collSurplusPool), _BNB);
    }

    /* Send _USDSamount USDS to the system and redeem the corresponding amount of collateral from as many Troves as are needed to fill the redemption
     * request.  Applies pending rewards to a Trove before reducing its debt and coll.
     *
     * Note that if _amount is very large, this function can run out of gas, specially if traversed troves are small. This can be easily avoided by
     * splitting the total _amount in appropriate chunks and calling the function multiple times.
     *
     * Param `_maxIterations` can also be provided, so the loop through Troves is capped (if it’s zero, it will be ignored).This makes it easier to
     * avoid OOG for the frontend, as only knowing approximately the average cost of an iteration is enough, without needing to know the “topology”
     * of the trove list. It also avoids the need to set the cap in stone in the contract, nor doing gas calculations, as both gas price and opcode
     * costs can vary.
     *
     * All Troves that are redeemed from -- with the likely exception of the last one -- will end up with no debt left, therefore they will be closed.
     * If the last Trove does have some remaining debt, it has a finite ICR, and the reinsertion could be anywhere in the list, therefore it requires a hint.
     * A frontend should use getRedemptionHints() to calculate what the ICR of this Trove will be after redemption, and pass a hint for its position
     * in the sortedTroves list along with the ICR value that the hint was found for.
     *
     * If another transaction modifies the list between calling getRedemptionHints() and passing the hints to redeemCollateral(), it
     * is very likely that the last (partially) redeemed Trove would end up with a different ICR than what the hint is for. In this case the
     * redemption will stop after the last completely redeemed Trove and the sender will keep the remaining USDS amount, which they can attempt
     * to redeem later.
     */
    function redeemCollateral(
        uint _USDSamount,
        address _firstRedemptionHint,
        address _upperPartialRedemptionHint,
        address _lowerPartialRedemptionHint,
        uint _partialRedemptionHintNICR,
        uint _maxIterations,
        uint _maxFeePercentage,
        bytes[] calldata priceFeedUpdateData
    ) external override {
        ContractsCache memory contractsCache = ContractsCache(
            activePool,
            defaultPool,
            usdsToken,
            sableStaking,
            sortedTroves,
            collSurplusPool,
            gasPoolAddress
        );
        RedemptionTotals memory totals;

        uint oracleRate;

        {
            troveHelper.requireValidMaxFeePercentage(_maxFeePercentage);
            troveHelper.requireAfterBootstrapPeriod();

            IPriceFeed.FetchPriceResult memory fetchPriceResult = priceFeed.fetchPrice(
                priceFeedUpdateData
            );
            totals.price = fetchPriceResult.price;

            // calculate oracleRate
            oracleRate = oracleRateCalc.getOracleRate(
                fetchPriceResult.oracleKey,
                fetchPriceResult.deviationPyth,
                fetchPriceResult.publishTimePyth
            );
        }

        troveHelper.requireTCRoverMCR(totals.price);
        troveHelper.requireAmountGreaterThanZero(_USDSamount);
        troveHelper.requireUSDSBalanceCoversRedemption(
            contractsCache.usdsToken,
            msg.sender,
            _USDSamount
        );

        totals.totalUSDSSupplyAtStart = getEntireSystemDebt();
        // Confirm redeemer's balance is less than total USDS supply
        assert(contractsCache.usdsToken.balanceOf(msg.sender) <= totals.totalUSDSSupplyAtStart);

        totals.remainingUSDS = _USDSamount;
        address currentBorrower;

        if (
            troveHelper.isValidFirstRedemptionHint(
                contractsCache.sortedTroves,
                _firstRedemptionHint,
                totals.price
            )
        ) {
            currentBorrower = _firstRedemptionHint;
        } else {
            currentBorrower = contractsCache.sortedTroves.getLast();
            // Find the first trove with ICR >= MCR
            while (
                currentBorrower != address(0) &&
                getCurrentICR(currentBorrower, totals.price) < systemState.getMCR()
            ) {
                currentBorrower = contractsCache.sortedTroves.getPrev(currentBorrower);
            }
        }

        // Loop through the Troves starting from the one with lowest collateral ratio until _amount of USDS is exchanged for collateral
        if (_maxIterations == 0) {
            _maxIterations = uint(-1);
        }
        while (currentBorrower != address(0) && totals.remainingUSDS > 0 && _maxIterations > 0) {
            _maxIterations--;
            // Save the address of the Trove preceding the current one, before potentially modifying the list
            address nextUserToCheck = contractsCache.sortedTroves.getPrev(currentBorrower);

            _applyPendingRewards(
                contractsCache.activePool,
                contractsCache.defaultPool,
                currentBorrower
            );

            RedeemCollateralFromTroveParam memory redeemParam = RedeemCollateralFromTroveParam({
                contractsCache: contractsCache,
                borrower: currentBorrower,
                maxUSDSamount: totals.remainingUSDS,
                price: totals.price,
                upperPartialRedemptionHint: _upperPartialRedemptionHint,
                lowerPartialRedemptionHint: _lowerPartialRedemptionHint,
                partialRedemptionHintNICR: _partialRedemptionHintNICR
            });

            SingleRedemptionValues memory singleRedemption = _redeemCollateralFromTrove(redeemParam);

            if (singleRedemption.cancelledPartial) break; // Partial redemption was cancelled (out-of-date hint, or new net debt < minimum), therefore we could not redeem from the last Trove

            totals.totalUSDSToRedeem = totals.totalUSDSToRedeem.add(singleRedemption.USDSLot);
            totals.totalBNBDrawn = totals.totalBNBDrawn.add(singleRedemption.BNBLot);

            totals.remainingUSDS = totals.remainingUSDS.sub(singleRedemption.USDSLot);
            currentBorrower = nextUserToCheck;
        }
        require(totals.totalBNBDrawn > 0, "4");

        // Decay the baseRate due to time passed, and then increase it according to the size of this redemption.
        // Use the saved total USDS supply value, from before it was reduced by the redemption.
        _updateBaseRateFromRedemption(
            totals.totalBNBDrawn,
            totals.price,
            totals.totalUSDSSupplyAtStart
        );

        // Calculate the BNB fee
        totals.BNBFee = _getRedemptionFee(totals.totalBNBDrawn, oracleRate);

        _requireUserAcceptsFee(totals.BNBFee, totals.totalBNBDrawn, _maxFeePercentage);

        // Send the BNB fee to the SABLE staking contract
        contractsCache.activePool.sendBNB(address(contractsCache.sableStaking), totals.BNBFee);
        contractsCache.sableStaking.increaseF_BNB(totals.BNBFee);

        totals.BNBToSendToRedeemer = totals.totalBNBDrawn.sub(totals.BNBFee);

        emit Redemption(_USDSamount, totals.totalUSDSToRedeem, totals.totalBNBDrawn, totals.BNBFee);

        // Burn the total USDS that is cancelled with debt, and send the redeemed BNB to msg.sender
        contractsCache.usdsToken.burn(msg.sender, totals.totalUSDSToRedeem);
        // Update Active Pool USDS, and send BNB to account
        contractsCache.activePool.decreaseUSDSDebt(totals.totalUSDSToRedeem);
        contractsCache.activePool.sendBNB(msg.sender, totals.BNBToSendToRedeemer);
    }

    // --- Helper functions ---

    // Return the nominal collateral ratio (ICR) of a given Trove, without the price. Takes a trove's pending coll and debt rewards from redistributions into account.
    function getNominalICR(address _borrower) public view override returns (uint) {
        (uint currentBNB, uint currentUSDSDebt) = _getCurrentTroveAmounts(_borrower);

        // uint NICR = LiquityMath._computeNominalCR(currentBNB, currentUSDSDebt);
        return LiquityMath._computeNominalCR(currentBNB, currentUSDSDebt);
    }

    // Return the current collateral ratio (ICR) of a given Trove. Takes a trove's pending coll and debt rewards from redistributions into account.
    function getCurrentICR(address _borrower, uint _price) public view override returns (uint) {
        (uint currentBNB, uint currentUSDSDebt) = _getCurrentTroveAmounts(_borrower);

        uint ICR = LiquityMath._computeCR(currentBNB, currentUSDSDebt, _price);
        return ICR;
    }

    function _getCurrentTroveAmounts(address _borrower) internal view returns (uint, uint) {
        uint pendingBNBReward = getPendingBNBReward(_borrower);
        uint pendingUSDSDebtReward = getPendingUSDSDebtReward(_borrower);

        return (
            Troves[_borrower].coll.add(pendingBNBReward),
            Troves[_borrower].debt.add(pendingUSDSDebtReward)
        );
    }

    function applyPendingRewards(address _borrower) external override {
        _requireCallerIsBorrowerOperations();
        return _applyPendingRewards(activePool, defaultPool, _borrower);
    }

    // Add the borrowers's coll and debt rewards earned from redistributions, to their Trove
    function _applyPendingRewards(
        IActivePool _activePool,
        IDefaultPool _defaultPool,
        address _borrower
    ) internal {
        if (hasPendingRewards(_borrower)) {
            _requireTroveIsActive(_borrower);

            // Compute pending rewards
            uint pendingBNBReward = getPendingBNBReward(_borrower);
            uint pendingUSDSDebtReward = getPendingUSDSDebtReward(_borrower);

            // Apply pending rewards to trove's state
            Troves[_borrower].coll = Troves[_borrower].coll.add(pendingBNBReward);
            Troves[_borrower].debt = Troves[_borrower].debt.add(pendingUSDSDebtReward);

            _updateTroveRewardSnapshots(_borrower);

            // Transfer from DefaultPool to ActivePool
            _movePendingTroveRewardsToActivePool(
                _activePool,
                _defaultPool,
                pendingUSDSDebtReward,
                pendingBNBReward
            );

            emit TroveUpdated(
                _borrower,
                Troves[_borrower].debt,
                Troves[_borrower].coll,
                Troves[_borrower].stake,
                TroveManagerOperation.applyPendingRewards
            );
        }
    }

    // Update borrower's snapshots of L_BNB and L_USDSDebt to reflect the current values
    function updateTroveRewardSnapshots(address _borrower) external override {
        _requireCallerIsBorrowerOperations();
        return _updateTroveRewardSnapshots(_borrower);
    }

    function _updateTroveRewardSnapshots(address _borrower) internal {
        rewardSnapshots[_borrower].BNB = L_BNB;
        rewardSnapshots[_borrower].USDSDebt = L_USDSDebt;
        emit TroveSnapshotsUpdated(L_BNB, L_USDSDebt);
    }

    // Get the borrower's pending accumulated BNB reward, earned by their stake
    function getPendingBNBReward(address _borrower) public view override returns (uint) {
        uint snapshotBNB = rewardSnapshots[_borrower].BNB;
        uint rewardPerUnitStaked = L_BNB.sub(snapshotBNB);

        if (rewardPerUnitStaked == 0 || Troves[_borrower].status != Status.active) {
            return 0;
        }

        uint stake = Troves[_borrower].stake;

        uint pendingBNBReward = stake.mul(rewardPerUnitStaked).div(DECIMAL_PRECISION);

        return pendingBNBReward;
    }

    // Get the borrower's pending accumulated USDS reward, earned by their stake
    function getPendingUSDSDebtReward(address _borrower) public view override returns (uint) {
        uint snapshotUSDSDebt = rewardSnapshots[_borrower].USDSDebt;
        uint rewardPerUnitStaked = L_USDSDebt.sub(snapshotUSDSDebt);

        if (rewardPerUnitStaked == 0 || Troves[_borrower].status != Status.active) {
            return 0;
        }

        uint stake = Troves[_borrower].stake;

        uint pendingUSDSDebtReward = stake.mul(rewardPerUnitStaked).div(DECIMAL_PRECISION);

        return pendingUSDSDebtReward;
    }

    function hasPendingRewards(address _borrower) public view override returns (bool) {
        /*
         * A Trove has pending rewards if its snapshot is less than the current rewards per-unit-staked sum:
         * this indicates that rewards have occured since the snapshot was made, and the user therefore has
         * pending rewards
         */
        if (Troves[_borrower].status != Status.active) {
            return false;
        }

        return (rewardSnapshots[_borrower].BNB < L_BNB);
    }

    // Return the Troves entire debt and coll, including pending rewards from redistributions.
    function getEntireDebtAndColl(
        address _borrower
    )
        public
        view
        override
        returns (uint debt, uint coll, uint pendingUSDSDebtReward, uint pendingBNBReward)
    {
        debt = Troves[_borrower].debt;
        coll = Troves[_borrower].coll;

        pendingUSDSDebtReward = getPendingUSDSDebtReward(_borrower);
        pendingBNBReward = getPendingBNBReward(_borrower);

        debt = debt.add(pendingUSDSDebtReward);
        coll = coll.add(pendingBNBReward);
    }

    function removeStake(address _borrower) external override {
        _requireCallerIsBorrowerOperations();
        return _removeStake(_borrower);
    }

    // Remove borrower's stake from the totalStakes sum, and set their stake to 0
    function _removeStake(address _borrower) internal {
        // uint stake = Troves[_borrower].stake;
        totalStakes = totalStakes.sub(Troves[_borrower].stake);
        Troves[_borrower].stake = 0;
    }

    function updateStakeAndTotalStakes(address _borrower) external override returns (uint) {
        _requireCallerIsBorrowerOperations();
        return _updateStakeAndTotalStakes(_borrower);
    }

    // Update borrower's stake based on their latest collateral value
    function _updateStakeAndTotalStakes(address _borrower) internal returns (uint) {
        uint newStake = _computeNewStake(Troves[_borrower].coll);
        uint oldStake = Troves[_borrower].stake;
        Troves[_borrower].stake = newStake;

        totalStakes = totalStakes.sub(oldStake).add(newStake);
        emit TotalStakesUpdated(totalStakes);

        return newStake;
    }

    // Calculate a new stake based on the snapshots of the totalStakes and totalCollateral taken at the last liquidation
    function _computeNewStake(uint _coll) internal view returns (uint) {
        uint stake;
        if (totalCollateralSnapshot == 0) {
            stake = _coll;
        } else {
            /*
             * The following assert() holds true because:
             * - The system always contains >= 1 trove
             * - When we close or liquidate a trove, we redistribute the pending rewards, so if all troves were closed/liquidated,
             * rewards would’ve been emptied and totalCollateralSnapshot would be zero too.
             */
            assert(totalStakesSnapshot > 0);
            stake = _coll.mul(totalStakesSnapshot).div(totalCollateralSnapshot);
        }
        return stake;
    }

    function _redistributeDebtAndColl(
        IActivePool _activePool,
        IDefaultPool _defaultPool,
        uint _debt,
        uint _coll
    ) internal {
        if (_debt == 0) {
            return;
        }

        /*
         * Add distributed coll and debt rewards-per-unit-staked to the running totals. Division uses a "feedback"
         * error correction, to keep the cumulative error low in the running totals L_BNB and L_USDSDebt:
         *
         * 1) Form numerators which compensate for the floor division errors that occurred the last time this
         * function was called.
         * 2) Calculate "per-unit-staked" ratios.
         * 3) Multiply each ratio back by its denominator, to reveal the current floor division error.
         * 4) Store these errors for use in the next correction when this function is called.
         * 5) Note: static analysis tools complain about this "division before multiplication", however, it is intended.
         */
        uint BNBNumerator = _coll.mul(DECIMAL_PRECISION).add(lastBNBError_Redistribution);
        uint USDSDebtNumerator = _debt.mul(DECIMAL_PRECISION).add(lastUSDSDebtError_Redistribution);

        // Get the per-unit-staked terms
        uint BNBRewardPerUnitStaked = BNBNumerator.div(totalStakes);
        uint USDSDebtRewardPerUnitStaked = USDSDebtNumerator.div(totalStakes);

        lastBNBError_Redistribution = BNBNumerator.sub(BNBRewardPerUnitStaked.mul(totalStakes));
        lastUSDSDebtError_Redistribution = USDSDebtNumerator.sub(
            USDSDebtRewardPerUnitStaked.mul(totalStakes)
        );

        // Add per-unit-staked terms to the running totals
        L_BNB = L_BNB.add(BNBRewardPerUnitStaked);
        L_USDSDebt = L_USDSDebt.add(USDSDebtRewardPerUnitStaked);

        emit LTermsUpdated(L_BNB, L_USDSDebt);

        // Transfer coll and debt from ActivePool to DefaultPool
        _activePool.decreaseUSDSDebt(_debt);
        _defaultPool.increaseUSDSDebt(_debt);
        _activePool.sendBNB(address(_defaultPool), _coll);
    }

    function closeTrove(address _borrower) external override {
        _requireCallerIsBorrowerOperations();
        return _closeTrove(_borrower, Status.closedByOwner);
    }

    function _closeTrove(address _borrower, Status closedStatus) internal {
        assert(closedStatus != Status.nonExistent && closedStatus != Status.active);

        uint TroveOwnersArrayLength = TroveOwners.length;
        troveHelper.requireMoreThanOneTroveInSystem(TroveOwnersArrayLength);

        Troves[_borrower].status = closedStatus;
        Troves[_borrower].coll = 0;
        Troves[_borrower].debt = 0;

        rewardSnapshots[_borrower].BNB = 0;
        rewardSnapshots[_borrower].USDSDebt = 0;

        _removeTroveOwner(_borrower, TroveOwnersArrayLength);
        sortedTroves.remove(_borrower);
    }

    /*
     * Updates snapshots of system total stakes and total collateral, excluding a given collateral remainder from the calculation.
     * Used in a liquidation sequence.
     *
     * The calculation excludes a portion of collateral that is in the ActivePool:
     *
     * the total BNB gas compensation from the liquidation sequence
     *
     * The BNB as compensation must be excluded as it is always sent out at the very end of the liquidation sequence.
     */
    function _updateSystemSnapshots_excludeCollRemainder(
        IActivePool _activePool,
        uint _collRemainder
    ) internal {
        totalStakesSnapshot = totalStakes;

        totalCollateralSnapshot = _activePool.getBNB().sub(_collRemainder).add(defaultPool.getBNB());

        emit SystemSnapshotsUpdated(totalStakesSnapshot, totalCollateralSnapshot);
    }

    // Push the owner's address to the Trove owners list, and record the corresponding array index on the Trove struct
    function addTroveOwnerToArray(address _borrower) external override returns (uint index) {
        _requireCallerIsBorrowerOperations();
        /* Max array size is 2**128 - 1, i.e. ~3e30 troves. No risk of overflow, since troves have minimum USDS
        debt of liquidation reserve plus MIN_NET_DEBT. 3e30 USDS dwarfs the value of all wealth in the world ( which is < 1e15 USD). */

        // Push the Troveowner to the array
        TroveOwners.push(_borrower);

        // Record the index of the new Troveowner on their Trove struct
        uint128 idx = uint128(TroveOwners.length.sub(1));
        Troves[_borrower].arrayIndex = idx;

        index = uint(idx);
        return index;
    }

    /*
     * Remove a Trove owner from the TroveOwners array, not preserving array order. Removing owner 'B' does the following:
     * [A B C D E] => [A E C D], and updates E's Trove struct to point to its new array index.
     */
    function _removeTroveOwner(address _borrower, uint TroveOwnersArrayLength) internal {
        Status troveStatus = Troves[_borrower].status;
        // It’s set in caller function `_closeTrove`
        assert(troveStatus != Status.nonExistent && troveStatus != Status.active);

        uint128 index = Troves[_borrower].arrayIndex;
        uint idxLast = TroveOwnersArrayLength.sub(1);

        assert(index <= idxLast);

        address addressToMove = TroveOwners[idxLast];

        TroveOwners[index] = addressToMove;
        Troves[addressToMove].arrayIndex = index;
        emit TroveIndexUpdated(addressToMove, index);

        TroveOwners.pop();
    }

    // --- Recovery Mode and TCR functions ---

    function getTCR(uint _price) external view override returns (uint) {
        return _getTCR(_price);
    }

    function checkRecoveryMode(uint _price) external view override returns (bool) {
        return _checkRecoveryMode(_price);
    }

    // Check whether or not the system *would be* in Recovery Mode, given an BNB:USD price, and the entire system coll and debt.
    function _checkPotentialRecoveryMode(
        uint _entireSystemColl,
        uint _entireSystemDebt,
        uint _price
    ) internal view returns (bool) {
        return
            LiquityMath._computeCR(_entireSystemColl, _entireSystemDebt, _price) <
            systemState.getCCR();
    }

    // --- Redemption fee functions ---

    /*
     * This function has two impacts on the baseRate state variable:
     * 1) decays the baseRate based on time passed since last redemption or USDS borrowing operation.
     * then,
     * 2) increases the baseRate based on the amount redeemed, as a proportion of total supply
     */
    function _updateBaseRateFromRedemption(
        uint _BNBDrawn,
        uint _price,
        uint _totalUSDSSupply
    ) internal returns (uint) {
        /* Convert the drawn BNB back to USDS at face value rate (1 USDS:1 USD), in order to get
         * the fraction of total supply that was redeemed at face value. */
        uint redeemedUSDSFraction = _BNBDrawn.mul(_price).div(_totalUSDSSupply);

        uint newBaseRate = LiquityMath._min(
            _calcDecayedBaseRate().add(redeemedUSDSFraction.div(BETA)),
            DECIMAL_PRECISION
        );
        //assert(newBaseRate <= DECIMAL_PRECISION); // This is already enforced in the line above
        assert(newBaseRate > 0); // Base rate is always non-zero after redemption

        // Update the baseRate state variable
        baseRate = newBaseRate;
        emit BaseRateUpdated(newBaseRate);

        _updateLastFeeOpTime();

        return newBaseRate;
    }

    function getRedemptionRate(uint _oracleRate) public view override returns (uint) {
        return _calcRedemptionRate(baseRate, _oracleRate);
    }

    function getRedemptionRateWithDecay(uint _oracleRate) public view override returns (uint) {
        return _calcRedemptionRate(_calcDecayedBaseRate(), _oracleRate);
    }

    function _calcRedemptionRate(uint _baseRate, uint _oracleRate) internal view returns (uint) {
        return
            LiquityMath._min(
                systemState.getRedemptionFeeFloor().add(_baseRate).add(_oracleRate),
                DECIMAL_PRECISION // cap at a maximum of 100%
            );
    }

    function _getRedemptionFee(uint _BNBDrawn, uint _oracleRate) internal view returns (uint) {
        return _calcRedemptionFee(getRedemptionRate(_oracleRate), _BNBDrawn);
    }

    function getRedemptionFeeWithDecay(
        uint _BNBDrawn,
        uint _oracleRate
    ) external view override returns (uint) {
        return _calcRedemptionFee(getRedemptionRateWithDecay(_oracleRate), _BNBDrawn);
    }

    function _calcRedemptionFee(uint _redemptionRate, uint _BNBDrawn) internal pure returns (uint) {
        uint redemptionFee = _redemptionRate.mul(_BNBDrawn).div(DECIMAL_PRECISION);
        require(redemptionFee < _BNBDrawn, "5");
        return redemptionFee;
    }

    // --- Borrowing fee functions ---

    function getBorrowingRate(uint _oracleRate) public view override returns (uint) {
        return _calcBorrowingRate(baseRate, _oracleRate);
    }

    function getBorrowingRateWithDecay(uint _oracleRate) public view override returns (uint) {
        return _calcBorrowingRate(_calcDecayedBaseRate(), _oracleRate);
    }

    function _calcBorrowingRate(uint _baseRate, uint _oracleRate) internal view returns (uint) {
        return
            LiquityMath._min(
                systemState.getBorrowingFeeFloor().add(_baseRate).add(_oracleRate),
                MAX_BORROWING_FEE
            );
    }

    function getBorrowingFee(
        uint _USDSDebt,
        uint _oracleRate
    ) external view override returns (uint) {
        return _calcBorrowingFee(getBorrowingRate(_oracleRate), _USDSDebt);
    }

    function getBorrowingFeeWithDecay(
        uint _USDSDebt,
        uint _oracleRate
    ) external view override returns (uint) {
        return _calcBorrowingFee(getBorrowingRateWithDecay(_oracleRate), _USDSDebt);
    }

    function _calcBorrowingFee(uint _borrowingRate, uint _USDSDebt) internal pure returns (uint) {
        return _borrowingRate.mul(_USDSDebt).div(DECIMAL_PRECISION);
    }

    // Updates the baseRate state variable based on time elapsed since the last redemption or USDS borrowing operation.
    function decayBaseRateFromBorrowing() external override {
        _requireCallerIsBorrowerOperations();

        uint decayedBaseRate = _calcDecayedBaseRate();
        assert(decayedBaseRate <= DECIMAL_PRECISION); // The baseRate can decay to 0

        baseRate = decayedBaseRate;
        emit BaseRateUpdated(decayedBaseRate);

        _updateLastFeeOpTime();
    }

    // --- Internal fee functions ---

    // Update the last fee operation time only if time passed >= decay interval. This prevents base rate griefing.
    function _updateLastFeeOpTime() internal {
        uint timePassed = block.timestamp.sub(lastFeeOperationTime);

        if (timePassed >= SECONDS_IN_ONE_MINUTE) {
            lastFeeOperationTime = block.timestamp;
            emit LastFeeOpTimeUpdated(block.timestamp);
        }
    }

    function _calcDecayedBaseRate() internal view returns (uint) {
        uint minutesPassed = (block.timestamp.sub(lastFeeOperationTime)).div(SECONDS_IN_ONE_MINUTE);
        uint decayFactor = LiquityMath._decPow(MINUTE_DECAY_FACTOR, minutesPassed);

        return baseRate.mul(decayFactor).div(DECIMAL_PRECISION);
    }

    // --- 'require' wrapper functions ---

    function _requireCallerIsBorrowerOperations() internal view {
        require(msg.sender == borrowerOperationsAddress, "6");
    }

    function _requireTroveIsActive(address _borrower) internal view {
        require(Troves[_borrower].status == Status.active, "7");
    }

    // --- Trove property getters ---

    function getTroveStatus(address _borrower) external view override returns (uint) {
        return uint(Troves[_borrower].status);
    }

    function getTroveStake(address _borrower) external view override returns (uint) {
        return Troves[_borrower].stake;
    }

    function getTroveDebt(address _borrower) external view override returns (uint) {
        return Troves[_borrower].debt;
    }

    function getTroveColl(address _borrower) external view override returns (uint) {
        return Troves[_borrower].coll;
    }

    // --- Trove property setters, called by BorrowerOperations ---

    function setTroveStatus(address _borrower, uint _num) external override {
        _requireCallerIsBorrowerOperations();
        Troves[_borrower].status = Status(_num);
    }

    function increaseTroveColl(
        address _borrower,
        uint _collIncrease
    ) external override returns (uint) {
        _requireCallerIsBorrowerOperations();
        uint newColl = Troves[_borrower].coll.add(_collIncrease);
        Troves[_borrower].coll = newColl;
        return newColl;
    }

    function decreaseTroveColl(
        address _borrower,
        uint _collDecrease
    ) external override returns (uint) {
        _requireCallerIsBorrowerOperations();
        uint newColl = Troves[_borrower].coll.sub(_collDecrease);
        Troves[_borrower].coll = newColl;
        return newColl;
    }

    function increaseTroveDebt(
        address _borrower,
        uint _debtIncrease
    ) external override returns (uint) {
        _requireCallerIsBorrowerOperations();
        uint newDebt = Troves[_borrower].debt.add(_debtIncrease);
        Troves[_borrower].debt = newDebt;
        return newDebt;
    }

    function decreaseTroveDebt(
        address _borrower,
        uint _debtDecrease
    ) external override returns (uint) {
        _requireCallerIsBorrowerOperations();
        uint newDebt = Troves[_borrower].debt.sub(_debtDecrease);
        Troves[_borrower].debt = newDebt;
        return newDebt;
    }
}
