// SPDX-License-Identifier: MIT

pragma solidity 0.6.11;
pragma experimental ABIEncoderV2;

import "../PriceFeed.sol";

contract PriceFeedTester is PriceFeed {

    uint256 private _price = 200 * 1e18;

    IPriceFeed.FetchPriceResult private _fetchPriceResult = IPriceFeed.FetchPriceResult({
        price: _price,
        oracleKey: bytes32("LINK"),
        deviationPyth: 0,
        publishTimePyth: 0
    });

    function setLastGoodPrice(uint _lastGoodPrice) external {
        lastGoodPrice = _lastGoodPrice;
    }

    function setStatus(Status _status) external {
        status = _status;
    }

    function setAddressesTestnet(
        address _priceAggregatorAddress,
        address _pythAddress,
        address _troveManagerAddress,
        address _borrowerOperationsAddress,
        address _stabilityPoolAddress,
        bytes32 _bnbPriceFeedId
    )
        external
        payable
        onlyOwner
    {
        troveManagerAddress = _troveManagerAddress;
        borrowerOperationsAddress = _borrowerOperationsAddress;
        stabilityPoolAddress = _stabilityPoolAddress;
       
        priceAggregator = AggregatorV3Interface(_priceAggregatorAddress);
        pyth = IPyth(_pythAddress);

        // Explicitly set initial system status
        status = Status.pythWorking;

        _setBNBFeed(_bnbPriceFeedId);

        _storePrice(_price);

        _renounceOwnership();
    }

    function logPythFetchPriceResult(bytes[] calldata priceFeedUpdateData)
        payable 
        public 
    {
        uint updateFee = pyth.getUpdateFee(priceFeedUpdateData);
        pyth.updatePriceFeeds{value: updateFee}(priceFeedUpdateData);

        _fetchPriceResult = this.fetchPrice(priceFeedUpdateData);
    }

    function getInternalFetchPriceResult() public view returns (IPriceFeed.FetchPriceResult memory) {
        return _fetchPriceResult;
    }

}