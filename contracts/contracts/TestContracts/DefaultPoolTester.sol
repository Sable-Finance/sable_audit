// SPDX-License-Identifier: MIT

pragma solidity 0.6.11;

import "../DefaultPool.sol";

contract DefaultPoolTester is DefaultPool {
    
    function unprotectedIncreaseUSDSDebt(uint _amount) external {
        USDSDebt  = USDSDebt.add(_amount);
    }

    function unprotectedPayable() external payable {
        BNB = BNB.add(msg.value);
    }
}
