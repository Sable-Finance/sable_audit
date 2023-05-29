// SPDX-License-Identifier: MIT

pragma solidity 0.6.11;

// Common interface for the Pools.
interface IPool {
    
    // --- Events ---
    
    event BNBBalanceUpdated(uint _newBalance);
    event USDSBalanceUpdated(uint _newBalance);
    event ActivePoolAddressChanged(address _newActivePoolAddress);
    event DefaultPoolAddressChanged(address _newDefaultPoolAddress);
    event StabilityPoolAddressChanged(address _newStabilityPoolAddress);
    event EtherSent(address _to, uint _amount);

    // --- Functions ---
    
    function getBNB() external view returns (uint);

    function getUSDSDebt() external view returns (uint);

    function increaseUSDSDebt(uint _amount) external;

    function decreaseUSDSDebt(uint _amount) external;
}
