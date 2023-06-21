// SPDX-License-Identifier: MIT

pragma solidity 0.6.11;

import "../Dependencies/CheckContract.sol";
import "../Interfaces/ISableStakingV2.sol";


contract SableStakingV2Script is CheckContract {
    ISableStakingV2 immutable SableStakingV2;

    constructor(address _sableStakingAddress) public {
        checkContract(_sableStakingAddress);
        SableStakingV2 = ISableStakingV2(_sableStakingAddress);
    }

    function stake(uint _SABLEamount) external {
        SableStakingV2.stake(_SABLEamount);
    }
}
