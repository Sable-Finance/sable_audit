// SPDX-License-Identifier: MIT

pragma solidity 0.6.11;

import "./IPool.sol";


interface IActivePool is IPool {
    // --- Events ---
    event BorrowerOperationsAddressChanged(address _newBorrowerOperationsAddress);
    event TroveManagerAddressChanged(address _newTroveManagerAddress);
    event ActivePoolUSDSDebtUpdated(uint _USDSDebt);
    event ActivePoolBNBBalanceUpdated(uint _BNB);

    // --- Functions ---
    function sendBNB(address _account, uint _amount) external;
}
