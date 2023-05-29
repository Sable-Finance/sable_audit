// SPDX-License-Identifier: MIT

pragma solidity 0.6.11;

import './Interfaces/IActivePool.sol';
import "./Dependencies/SafeMath.sol";
import "./Dependencies/Ownable.sol";
import "./Dependencies/CheckContract.sol";
import "./Dependencies/console.sol";

/*
 * The Active Pool holds the BNB collateral and USDS debt (but not USDS tokens) for all active troves.
 *
 * When a trove is liquidated, it's BNB and USDS debt are transferred from the Active Pool, to either the
 * Stability Pool, the Default Pool, or both, depending on the liquidation conditions.
 *
 */
contract ActivePool is Ownable, CheckContract, IActivePool {
    using SafeMath for uint256;

    string constant public NAME = "ActivePool";

    address public borrowerOperationsAddress;
    address public troveManagerAddress;
    address public stabilityPoolAddress;
    address public defaultPoolAddress;
    uint256 internal BNB;  // deposited ether tracker
    uint256 internal USDSDebt;

    // --- Events ---

    event BorrowerOperationsAddressChanged(address _newBorrowerOperationsAddress);
    event TroveManagerAddressChanged(address _newTroveManagerAddress);
    event ActivePoolUSDSDebtUpdated(uint _USDSDebt);
    event ActivePoolBNBBalanceUpdated(uint _BNB);

    // --- Contract setters ---

    function setAddresses(
        address _borrowerOperationsAddress,
        address _troveManagerAddress,
        address _stabilityPoolAddress,
        address _defaultPoolAddress
    )
        external
        onlyOwner
    {
        checkContract(_borrowerOperationsAddress);
        checkContract(_troveManagerAddress);
        checkContract(_stabilityPoolAddress);
        checkContract(_defaultPoolAddress);

        borrowerOperationsAddress = _borrowerOperationsAddress;
        troveManagerAddress = _troveManagerAddress;
        stabilityPoolAddress = _stabilityPoolAddress;
        defaultPoolAddress = _defaultPoolAddress;

        emit BorrowerOperationsAddressChanged(_borrowerOperationsAddress);
        emit TroveManagerAddressChanged(_troveManagerAddress);
        emit StabilityPoolAddressChanged(_stabilityPoolAddress);
        emit DefaultPoolAddressChanged(_defaultPoolAddress);

        _renounceOwnership();
    }

    // --- Getters for public variables. Required by IPool interface ---

    /*
    * Returns the BNB state variable.
    *
    *Not necessarily equal to the the contract's raw BNB balance - ether can be forcibly sent to contracts.
    */
    function getBNB() external view override returns (uint) {
        return BNB;
    }

    function getUSDSDebt() external view override returns (uint) {
        return USDSDebt;
    }

    // --- Pool functionality ---

    function sendBNB(address _account, uint _amount) external override {
        _requireCallerIsBOorTroveMorSP();
        BNB = BNB.sub(_amount);
        emit ActivePoolBNBBalanceUpdated(BNB);
        emit EtherSent(_account, _amount);

        (bool success, ) = _account.call{ value: _amount }("");
        require(success, "ActivePool: sending BNB failed");
    }

    function increaseUSDSDebt(uint _amount) external override {
        _requireCallerIsBOorTroveM();
        USDSDebt  = USDSDebt.add(_amount);
        ActivePoolUSDSDebtUpdated(USDSDebt);
    }

    function decreaseUSDSDebt(uint _amount) external override {
        _requireCallerIsBOorTroveMorSP();
        USDSDebt = USDSDebt.sub(_amount);
        ActivePoolUSDSDebtUpdated(USDSDebt);
    }

    // --- 'require' functions ---

    function _requireCallerIsBorrowerOperationsOrDefaultPool() internal view {
        require(
            msg.sender == borrowerOperationsAddress ||
            msg.sender == defaultPoolAddress,
            "ActivePool: Caller is neither BO nor Default Pool");
    }

    function _requireCallerIsBOorTroveMorSP() internal view {
        require(
            msg.sender == borrowerOperationsAddress ||
            msg.sender == troveManagerAddress ||
            msg.sender == stabilityPoolAddress,
            "ActivePool: Caller is neither BorrowerOperations nor TroveManager nor StabilityPool");
    }

    function _requireCallerIsBOorTroveM() internal view {
        require(
            msg.sender == borrowerOperationsAddress ||
            msg.sender == troveManagerAddress,
            "ActivePool: Caller is neither BorrowerOperations nor TroveManager");
    }

    // --- Fallback function ---

    receive() external payable {
        _requireCallerIsBorrowerOperationsOrDefaultPool();
        BNB = BNB.add(msg.value);
        emit ActivePoolBNBBalanceUpdated(BNB);
    }
}
