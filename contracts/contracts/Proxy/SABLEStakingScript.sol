// SPDX-License-Identifier: MIT

pragma solidity 0.6.11;

import "../Dependencies/CheckContract.sol";
import "../Interfaces/ISABLEStaking.sol";


contract SABLEStakingScript is CheckContract {
    ISABLEStaking immutable SABLEStaking;

    constructor(address _sableStakingAddress) public {
        checkContract(_sableStakingAddress);
        SABLEStaking = ISABLEStaking(_sableStakingAddress);
    }

    function stake(uint _SABLEamount) external {
        SABLEStaking.stake(_SABLEamount);
    }
}
