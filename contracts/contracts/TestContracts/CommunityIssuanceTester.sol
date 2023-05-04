// SPDX-License-Identifier: MIT

pragma solidity 0.6.11;

import "../LQTY/CommunityIssuance.sol";

contract CommunityIssuanceTester is CommunityIssuance {
    function obtainLQTY(uint _amount) external {
        lqtyToken.transfer(msg.sender, _amount);
    }

    function getCumulativeIssuanceFraction() external view returns (uint) {
        return 0; // TODO: for test issurance
    }

    function unprotectedIssueLQTY() external returns (uint) {
        // No checks on caller address

        return 0; // TODO: for test issurance
    }
}
