// SPDX-License-Identifier: MIT

pragma solidity 0.6.11;

import './Interfaces/IDefaultPool.sol';
import "./Dependencies/SafeMath.sol";
import "./Dependencies/Ownable.sol";
import "./Dependencies/CheckContract.sol";
import "./Dependencies/console.sol";

/*
 * The Default Pool holds the BNB and USDS debt (but not USDS tokens) from liquidations that have been redistributed
 * to active troves but not yet "applied", i.e. not yet recorded on a recipient active trove's struct.
 *
 * When a trove makes an operation that applies its pending BNB and USDS debt, its pending BNB and USDS debt is moved
 * from the Default Pool to the Active Pool.
 */
contract DefaultPool is Ownable, CheckContract, IDefaultPool {
    using SafeMath for uint256;

    string constant public NAME = "DefaultPool";

    address public troveManagerAddress;
    address public activePoolAddress;
    uint256 internal BNB;  // deposited BNB tracker
    uint256 internal USDSDebt;  // debt

    event TroveManagerAddressChanged(address _newTroveManagerAddress);
    event DefaultPoolUSDSDebtUpdated(uint _USDSDebt);
    event DefaultPoolBNBBalanceUpdated(uint _BNB);

    // --- Dependency setters ---

    function setAddresses(
        address _troveManagerAddress,
        address _activePoolAddress
    )
        external
        onlyOwner
    {
        checkContract(_troveManagerAddress);
        checkContract(_activePoolAddress);

        troveManagerAddress = _troveManagerAddress;
        activePoolAddress = _activePoolAddress;

        emit TroveManagerAddressChanged(_troveManagerAddress);
        emit ActivePoolAddressChanged(_activePoolAddress);

        _renounceOwnership();
    }

    // --- Getters for public variables. Required by IPool interface ---

    /*
    * Returns the BNB state variable.
    *
    * Not necessarily equal to the the contract's raw BNB balance - ether can be forcibly sent to contracts.
    */
    function getBNB() external view override returns (uint) {
        return BNB;
    }

    function getUSDSDebt() external view override returns (uint) {
        return USDSDebt;
    }

    // --- Pool functionality ---

    function sendBNBToActivePool(uint _amount) external override {
        _requireCallerIsTroveManager();
        address activePool = activePoolAddress; // cache to save an SLOAD
        BNB = BNB.sub(_amount);
        emit DefaultPoolBNBBalanceUpdated(BNB);
        emit EtherSent(activePool, _amount);

        (bool success, ) = activePool.call{ value: _amount }("");
        require(success, "DefaultPool: sending BNB failed");
    }

    function increaseUSDSDebt(uint _amount) external override {
        _requireCallerIsTroveManager();
        USDSDebt = USDSDebt.add(_amount);
        emit DefaultPoolUSDSDebtUpdated(USDSDebt);
    }

    function decreaseUSDSDebt(uint _amount) external override {
        _requireCallerIsTroveManager();
        USDSDebt = USDSDebt.sub(_amount);
        emit DefaultPoolUSDSDebtUpdated(USDSDebt);
    }

    // --- 'require' functions ---

    function _requireCallerIsActivePool() internal view {
        require(msg.sender == activePoolAddress, "DefaultPool: Caller is not the ActivePool");
    }

    function _requireCallerIsTroveManager() internal view {
        require(msg.sender == troveManagerAddress, "DefaultPool: Caller is not the TroveManager");
    }

    // --- Fallback function ---

    receive() external payable {
        _requireCallerIsActivePool();
        BNB = BNB.add(msg.value);
        emit DefaultPoolBNBBalanceUpdated(BNB);
    }
}
