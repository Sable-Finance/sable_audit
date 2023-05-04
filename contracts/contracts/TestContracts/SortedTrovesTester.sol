// SPDX-License-Identifier: MIT

pragma solidity 0.6.11;
pragma experimental ABIEncoderV2;

import "../Interfaces/ISortedTroves.sol";


contract SortedTrovesTester {
    ISortedTroves sortedTroves;

    function setSortedTroves(address _sortedTrovesAddress) external {
        sortedTroves = ISortedTroves(_sortedTrovesAddress);
    }

    function insert(ISortedTroves.SortedTrovesInsertParam memory param) external {
        sortedTroves.insert(param);
    }

    function remove(address _id) external {
        sortedTroves.remove(_id);
    }

    function reInsert(ISortedTroves.SortedTrovesInsertParam memory param) external {
        sortedTroves.reInsert(param);
    }

    function getNominalICR(address) external pure returns (uint) {
        return 1;
    }

    function getCurrentICR(address, uint) external pure returns (uint) {
        return 1;
    }
}
