// SPDX-License-Identifier: MIT

pragma solidity 0.6.11;
pragma experimental ABIEncoderV2;

import "./IPyth.sol";

interface IPriceFeed {

    // --- Events ---
    event LastGoodPriceUpdated(uint _lastGoodPrice);

    struct FetchPriceResult {
        uint price;
        bytes32 oracleKey;
        uint deviationPyth;
        uint publishTimePyth;
    }
   
    // --- Function ---
    // return price, oracleKey, deviationPyth, publishTimePyth
    // if get price from Chainlink, deviationPyth = publishTimePyth = 0
    function fetchPrice(bytes[] calldata priceFeedUpdateData) external returns (FetchPriceResult memory);

    function pyth() external view returns (IPyth);
}
