// SPDX-License-Identifier: MIT

pragma solidity 0.6.11;

import "./BaseMath.sol";
import "./LiquityMath.sol";
import "../Interfaces/IActivePool.sol";
import "../Interfaces/IDefaultPool.sol";
import "../Interfaces/IPriceFeed.sol";
import "../Interfaces/ILiquityBase.sol";
import "../Interfaces/ISystemState.sol";

/*
 * Base contract for TroveManager, BorrowerOperations and StabilityPool. Contains global system constants and
 * common functions.
 */
contract LiquityBase is BaseMath, ILiquityBase {
    using SafeMath for uint;

    uint public constant _100pct = 1000000000000000000; // 1e18 == 100%

    uint public constant PERCENT_DIVISOR = 200; // dividing by 200 yields 0.5%

    address public timeLock;

    IActivePool public activePool;

    IDefaultPool public defaultPool;

    IPriceFeed public override priceFeed;

    ISystemState public systemState;

    // --- Gas compensation functions ---

    // Returns the composite debt (drawn debt + gas compensation) of a trove, for the purpose of ICR calculation
    function _getCompositeDebt(uint _debt) internal view returns (uint) {
        uint USDS_GAS_COMPENSATION = systemState.getUSDSGasCompensation();
        return _debt.add(USDS_GAS_COMPENSATION);
    }

    function _getNetDebt(uint _debt) internal view returns (uint) {
        uint USDS_GAS_COMPENSATION = systemState.getUSDSGasCompensation();
        return _debt.sub(USDS_GAS_COMPENSATION);
    }

    // Return the amount of BNB to be drawn from a trove's collateral and sent as gas compensation.
    function _getCollGasCompensation(uint _entireColl) internal pure returns (uint) {
        return _entireColl / PERCENT_DIVISOR;
    }

    function getEntireSystemColl() public view returns (uint entireSystemColl) {
        uint activeColl = activePool.getBNB();
        uint liquidatedColl = defaultPool.getBNB();

        return activeColl.add(liquidatedColl);
    }

    function getEntireSystemDebt() public view returns (uint entireSystemDebt) {
        uint activeDebt = activePool.getUSDSDebt();
        uint closedDebt = defaultPool.getUSDSDebt();

        return activeDebt.add(closedDebt);
    }

    function _getTCR(uint _price) internal view returns (uint TCR) {
        uint entireSystemColl = getEntireSystemColl();
        uint entireSystemDebt = getEntireSystemDebt();

        TCR = LiquityMath._computeCR(entireSystemColl, entireSystemDebt, _price);

        return TCR;
    }

    function _checkRecoveryMode(uint _price) internal view returns (bool) {
        uint TCR = _getTCR(_price);
        uint CCR = systemState.getCCR();
        return TCR < CCR;
    }

    function _requireUserAcceptsFee(uint _fee, uint _value, uint _maxFeePercentage) internal pure {
        uint feePercentage = _fee.mul(DECIMAL_PRECISION).div(_value);
        require(feePercentage <= _maxFeePercentage, "Fee exceeded provided maximum");
    }
}
