// SPDX-License-Identifier: MIT

pragma solidity 0.6.11;
pragma experimental ABIEncoderV2;

import "./TroveManager.sol";
import "./Interfaces/ITroveHelper.sol";

contract TroveHelper is LiquityBase, Ownable, CheckContract, ITroveHelper {
    TroveManager public troveManager;
    ISortedTroves public sortedTroves;
    ILQTYToken public lqtyToken;

    function setAddresses(
        address _troveManagerAddress,
        address _systemStateAddress,
        address _sortedTrovesAddress,
        address _lqtyTokenAddress,
        address _activePoolAddress,
        address _defaultPoolAddress
    ) external override onlyOwner {
        checkContract(_troveManagerAddress);
        checkContract(_systemStateAddress);
        checkContract(_sortedTrovesAddress);
        checkContract(_lqtyTokenAddress);
        troveManager = TroveManager(_troveManagerAddress);
        systemState = ISystemState(_systemStateAddress);
        sortedTroves = ISortedTroves(_sortedTrovesAddress);
        lqtyToken = ILQTYToken(_lqtyTokenAddress);
        activePool = IActivePool(_activePoolAddress);
        defaultPool = IDefaultPool(_defaultPoolAddress);
    }

    /*
     *  Get its offset coll/debt and ETH gas comp, and close the trove.
     */
    function getCappedOffsetVals(
        uint _entireTroveDebt,
        uint _entireTroveColl,
        uint _price
    ) external view override returns (ITroveManager.LiquidationValues memory singleLiquidation) {
        _requireCallerIsTroveManager();

        singleLiquidation.entireTroveDebt = _entireTroveDebt;
        singleLiquidation.entireTroveColl = _entireTroveColl;
        uint cappedCollPortion = _entireTroveDebt.mul(systemState.getMCR()).div(_price);
        singleLiquidation.collGasCompensation = _getCollGasCompensation(cappedCollPortion);
        singleLiquidation.LUSDGasCompensation = systemState.getLUSDGasCompensation();

        singleLiquidation.debtToOffset = _entireTroveDebt;
        singleLiquidation.collToSendToSP = cappedCollPortion.sub(
            singleLiquidation.collGasCompensation
        );
        singleLiquidation.collSurplus = _entireTroveColl.sub(cappedCollPortion);
        singleLiquidation.debtToRedistribute = 0;
        singleLiquidation.collToRedistribute = 0;
    }

    function isValidFirstRedemptionHint(
        ISortedTroves _sortedTroves,
        address _firstRedemptionHint,
        uint _price
    ) external view override returns (bool) {
        _requireCallerIsTroveManager();

        uint MCR = systemState.getMCR();
        if (
            _firstRedemptionHint == address(0) ||
            !_sortedTroves.contains(_firstRedemptionHint) ||
            troveManager.getCurrentICR(_firstRedemptionHint, _price) < MCR
        ) {
            return false;
        }

        address nextTrove = _sortedTroves.getNext(_firstRedemptionHint);
        return nextTrove == address(0) || troveManager.getCurrentICR(nextTrove, _price) < MCR;
    }

    // Require wrappers

    function requireValidMaxFeePercentage(uint _maxFeePercentage) external view override {
        _requireCallerIsTroveManager();

        uint REDEMPTION_FEE_FLOOR = systemState.getRedemptionFeeFloor();
        require(
            _maxFeePercentage >= REDEMPTION_FEE_FLOOR && _maxFeePercentage <= DECIMAL_PRECISION,
            "Max fee percentage must be between 0.5% and 100%"
        );
    }

    function requireAfterBootstrapPeriod() external view override {
        _requireCallerIsTroveManager();

        uint systemDeploymentTime = lqtyToken.getDeploymentStartTime();
        require(
            block.timestamp >= systemDeploymentTime.add(troveManager.BOOTSTRAP_PERIOD()),
            "TroveManager: Redemptions are not allowed during bootstrap phase"
        );
    }

    function requireLUSDBalanceCoversRedemption(
        ILUSDToken _lusdToken,
        address _redeemer,
        uint _amount
    ) external view override {
        _requireCallerIsTroveManager();

        require(
            _lusdToken.balanceOf(_redeemer) >= _amount,
            "TroveManager: Requested redemption amount must be <= user's LUSD token balance"
        );
    }

    function requireMoreThanOneTroveInSystem(uint TroveOwnersArrayLength) external view override {
        _requireCallerIsTroveManager();

        require(
            TroveOwnersArrayLength > 1 && sortedTroves.getSize() > 1,
            "TroveManager: Only one trove in the system"
        );
    }

    function requireAmountGreaterThanZero(uint _amount) external view override {
        _requireCallerIsTroveManager();

        require(_amount > 0, "TroveManager: Amount must be greater than zero");
    }

    function requireTCRoverMCR(uint _price) external view override {
        _requireCallerIsTroveManager();

        require(
            _getTCR(_price) >= systemState.getMCR(),
            "TroveManager: Cannot redeem when TCR < MCR"
        );
    }

    // Check whether or not the system *would be* in Recovery Mode, given an ETH:USD price, and the entire system coll and debt.
    function checkPotentialRecoveryMode(
        uint _entireSystemColl,
        uint _entireSystemDebt,
        uint _price
    ) external view override returns (bool) {
        _requireCallerIsTroveManager();

        return
            LiquityMath._computeCR(_entireSystemColl, _entireSystemDebt, _price) <
            systemState.getCCR();
    }

    function _requireCallerIsTroveManager() internal view {
        require(
            msg.sender == address(troveManager),
            "TroveHelper: Caller is not the TroveManager contract"
        );
    }
}
