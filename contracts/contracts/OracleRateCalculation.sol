// SPDX-License-Identifier: MIT

pragma solidity 0.6.11;

import "./Interfaces/IOracleRateCalculation.sol";
import "./Dependencies/LiquityMath.sol";
import "./Dependencies/BaseMath.sol";

contract OracleRateCalculation is BaseMath, IOracleRateCalculation {
    using SafeMath for uint;

    uint constant public MAX_ORACLE_RATE_PERCENTAGE = 25 * DECIMAL_PRECISION / 10000; // 0.25% * DECIMAL_PRECISION

    function getOracleRate(
        bytes32 oracleKey, 
        uint deviationPyth, 
        uint publishTimePyth
    ) external view override returns (uint oracleRate) {
        if (oracleKey == bytes32("PYTH")) {
            uint absDelayTime = block.timestamp > publishTimePyth 
                ? block.timestamp.sub(publishTimePyth)
                : publishTimePyth.sub(block.timestamp);
            
            oracleRate = deviationPyth.add(absDelayTime.mul(DECIMAL_PRECISION).div(10000));
            if (oracleRate > MAX_ORACLE_RATE_PERCENTAGE) {
                oracleRate = MAX_ORACLE_RATE_PERCENTAGE;
            }
        } else {
            oracleRate = MAX_ORACLE_RATE_PERCENTAGE;
        }
    }
}