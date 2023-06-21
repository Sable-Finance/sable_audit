// SPDX-License-Identifier: MIT

pragma solidity 0.6.11;

import "../SABLE/SableStakingV2.sol";


contract SableStakingTester is SableStakingV2 {
    function requireCallerIsTroveManager() external view {
        _requireCallerIsTroveManager();
    }
}
