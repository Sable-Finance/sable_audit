// SPDX-License-Identifier: MIT

pragma solidity 0.6.11;
pragma experimental ABIEncoderV2;

import "../TroveManager.sol";
import "../Interfaces/ISystemState.sol";

/* Tester contract inherits from TroveManager, and provides external functions 
for testing the parent's internal functions. */

contract TroveManagerTester is TroveManager {

    ISystemState private _systemState;
    function setSystemState(address _systemStateAddress) external {
        _systemState = ISystemState(_systemStateAddress);
    }

    function computeICR(uint _coll, uint _debt, uint _price) external pure returns (uint) {
        return LiquityMath._computeCR(_coll, _debt, _price);
    }

    function getCollGasCompensation(uint _coll) external pure returns (uint) {
        return _getCollGasCompensation(_coll);
    }

    function getLUSDGasCompensation() external view returns (uint) {
        // uint LUSD_GAS_COMPENSATION = systemState.getLUSDGasCompensation();
        uint LUSD_GAS_COMPENSATION = _systemState.getLUSDGasCompensation();
        return LUSD_GAS_COMPENSATION;
    }

    function getCompositeDebt(uint _debt) external view returns (uint) {
        // return _getCompositeDebt(_debt);
        uint LUSD_GAS_COMPENSATION = _systemState.getLUSDGasCompensation();
        return _debt.add(LUSD_GAS_COMPENSATION);
    }

    function unprotectedDecayBaseRateFromBorrowing() external returns (uint) {
        baseRate = _calcDecayedBaseRate();
        assert(baseRate >= 0 && baseRate <= DECIMAL_PRECISION);

        _updateLastFeeOpTime();
        return baseRate;
    }

    function minutesPassedSinceLastFeeOp() external view returns (uint) {
        // return _minutesPassedSinceLastFeeOp();
        return (block.timestamp.sub(lastFeeOperationTime)).div(SECONDS_IN_ONE_MINUTE);
    }

    function setLastFeeOpTimeToNow() external {
        lastFeeOperationTime = block.timestamp;
    }

    function setBaseRate(uint _baseRate) external {
        baseRate = _baseRate;
    }

    function callGetRedemptionFee(uint _ETHDrawn, uint _oracleRate) external view returns (uint) {
        _getRedemptionFee(_ETHDrawn, _oracleRate);
    }

    function getActualDebtFromComposite(uint _debtVal) external view returns (uint) {
        return _getNetDebt(_debtVal);
    }

    function callInternalRemoveTroveOwner(address _troveOwner) external {
        uint troveOwnersArrayLength = TroveOwners.length;
        _removeTroveOwner(_troveOwner, troveOwnersArrayLength);
    }
}
