// SPDX-License-Identifier: MIT

pragma solidity 0.6.11;

import "./IPool.sol";


interface IDefaultPool is IPool {
    // --- Events ---
    event TroveManagerAddressChanged(address _newTroveManagerAddress);
    event DefaultPoolUSDSDebtUpdated(uint _USDSDebt);
    event DefaultPoolBNBBalanceUpdated(uint _BNB);

    // --- Functions ---
    function sendBNBToActivePool(uint _amount) external;
}
