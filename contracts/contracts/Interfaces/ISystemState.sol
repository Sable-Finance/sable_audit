// SPDX-License-Identifier: MIT

pragma solidity 0.6.11;

interface ISystemState {
    function setUSDSGasCompensation(uint _value) external;

    function setBorrowingFeeFloor(uint _value) external;

    function setRedemptionFeeFloor(uint _value) external;

    function setMinNetDebt(uint _value) external;

    function setMCR(uint _value) external;

    function setCCR(uint _value) external;

    function getUSDSGasCompensation() external view returns (uint);

    function getBorrowingFeeFloor() external view returns (uint);

    function getRedemptionFeeFloor() external view returns (uint);

    function getMinNetDebt() external view returns (uint);

    function getMCR() external view returns (uint);

    function getCCR() external view returns (uint);

    event USDSGasCompensationChanged(uint _o, uint _n);
    event BorrowingFeeFloorChanged(uint _o, uint _n);
    event RedemptionFeeFloorChanged(uint _o, uint _n);
    event MinNetDebtChanged(uint _o, uint _n);
    event MCR_Changed(uint _o, uint _n);
    event CCR_Changed(uint _o, uint _n);
}
