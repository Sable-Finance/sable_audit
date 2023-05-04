// SPDX-License-Identifier: MIT

pragma solidity 0.6.11;

interface IOracleRateCalculation {
    // --- Functions ---

    function getOracleRate(
        bytes32 oracleKey, 
        uint deviationPyth, 
        uint publishTimePyth
    ) external view returns (uint);
}