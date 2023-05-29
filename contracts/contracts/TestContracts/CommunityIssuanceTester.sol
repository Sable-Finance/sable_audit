// SPDX-License-Identifier: MIT

pragma solidity 0.6.11;

import "../SABLE/CommunityIssuance.sol";

contract CommunityIssuanceTester is CommunityIssuance {
    function obtainSABLE(uint _amount) external {
        sableToken.transfer(msg.sender, _amount);
    }

    function getCumulativeIssuanceFraction() external pure returns (uint) {
        return 0; // TODO: for test issurance
    }

    function unprotectedIssueSABLE() external pure returns (uint) {
        // No checks on caller address

        return 0; // TODO: for test issurance
    }
}
