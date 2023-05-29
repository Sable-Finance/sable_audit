// SPDX-License-Identifier: MIT

pragma solidity 0.6.11;

import "../SABLE/SABLEStaking.sol";


contract SABLEStakingTester is SABLEStaking {
    function requireCallerIsTroveManager() external view {
        _requireCallerIsTroveManager();
    }
}
