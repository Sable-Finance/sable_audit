// SPDX-License-Identifier: MIT

pragma solidity 0.6.11;

import "./Dependencies/LiquityMath.sol";
import "./Dependencies/CheckContract.sol";
import "./Interfaces/ISystemState.sol";
import "./Dependencies/Ownable.sol";

/*
 * Base contract for TroveManager, BorrowerOperations and StabilityPool. Contains global system constants and
 * common functions.
 */
contract SystemState is CheckContract, ISystemState, Ownable {
    using SafeMath for uint;

    // Minimum collateral ratio for individual troves
    uint private mcr; // 1100000000000000000; // 110%

    // Critical system collateral ratio. If the system's total collateral ratio (TCR) falls below the CCR, Recovery Mode is triggered.
    uint private ccr; // 1500000000000000000; // 150%

    // Amount of USDS to be locked in gas pool on opening troves
    uint private USDSGasCompensation; //  10e18;

    // Minimum amount of net USDS debt a trove must have
    uint private minNetDebt; // 90e18

    uint private borrowingFeeFloor; // 0.05%

    uint private redemptionFeeFloor; // 0.05%

    address private timeLock;

    function setConfigs(
        address _timelock,
        uint _mcr,
        uint _ccr,
        uint _USDSGasCompensation,
        uint _minNetDebt,
        uint _borrowingFeeFloor,
        uint _redemptionFeeFloor
    ) public onlyOwner {
        checkContract(_timelock);
        timeLock = _timelock;

        _setCCR(_ccr);
        _setMCR(_mcr);
        _setUSDSGasCompensation(_USDSGasCompensation);
        _setMinNetDebt(_minNetDebt);
        _setBorrowingFeeFloor(_borrowingFeeFloor);
        _setRedemptionFeeFloor(_redemptionFeeFloor);

        _renounceOwnership();
    }

    modifier onlyTimeLock() {
        require(msg.sender == timeLock, "Caller is not from timelock");
        _;
    }

    // External function

    function setUSDSGasCompensation(uint _value) external override onlyTimeLock {
        _setUSDSGasCompensation(_value);
    }

    function setBorrowingFeeFloor(uint _value) external override onlyTimeLock {
        _setBorrowingFeeFloor(_value);
    }

    function setRedemptionFeeFloor(uint _value) external override onlyTimeLock {
        _setRedemptionFeeFloor(_value);
    }

    function setMinNetDebt(uint _value) external override onlyTimeLock {
        _setMinNetDebt(_value);
    }

    function setMCR(uint _value) external override onlyTimeLock {
        _setMCR(_value);
    }

    function setCCR(uint _value) external override onlyTimeLock {
        _setCCR(_value);
    }

    function getUSDSGasCompensation() external view override returns (uint) {
        return USDSGasCompensation;
    }

    function getBorrowingFeeFloor() external view override returns (uint) {
        return borrowingFeeFloor;
    }

    function getRedemptionFeeFloor() external view override returns (uint) {
        return redemptionFeeFloor;
    }

    function getMinNetDebt() external view override returns (uint) {
        return minNetDebt;
    }

    function getMCR() external view override returns (uint) {
        return mcr;
    }

    function getCCR() external view override returns (uint) {
        return ccr;
    }

    // internal function
     function _setUSDSGasCompensation(uint _value) internal {
        uint oldValue = USDSGasCompensation;
        USDSGasCompensation = _value;
        emit USDSGasCompensationChanged(oldValue, _value);
    }

    function _setBorrowingFeeFloor(uint _value) internal {
        uint oldValue = borrowingFeeFloor;
        borrowingFeeFloor = _value;
        emit BorrowingFeeFloorChanged(oldValue, _value);
    }

    function _setRedemptionFeeFloor(uint _value) internal {
        uint oldValue = redemptionFeeFloor;
        redemptionFeeFloor = _value;
        emit RedemptionFeeFloorChanged(oldValue, _value);
    }

    function _setMinNetDebt(uint _value) internal {
        require(_value > 0, "SystemState: Min net debt must > 0");
        uint oldValue = minNetDebt;
        minNetDebt = _value;
        emit MinNetDebtChanged(oldValue, _value);
    }

    function _setMCR(uint _value) internal {
        require(_value > 1000000000000000000 && _value < ccr, "SystemState: 100% < MCR < CCR");
        uint oldValue = mcr;
        mcr = _value;
        emit MCR_Changed(oldValue, _value);
    }

    function _setCCR(uint _value) internal {
        require(_value > mcr, "SystemState: CCR > MCR");
        uint oldValue = ccr;
        ccr = _value;
        emit CCR_Changed(oldValue, _value);
    }
}
