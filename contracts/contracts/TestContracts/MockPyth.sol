// SPDX-License-Identifier: MIT
// pragma solidity 0.6.11;
pragma solidity 0.6.11;
pragma experimental ABIEncoderV2;

import "../Interfaces/AbstractPyth.sol";
import "../Interfaces/PythStructs.sol";

contract MockPyth is AbstractPyth {
    mapping(bytes32 => PythStructs.PriceFeed) priceFeeds;
    uint64 sequenceNumber;

    uint singleUpdateFeeInWei;
    uint validTimePeriod;

    PythStructs.PriceFeed private _priceFeed;

    constructor(uint _validTimePeriod, uint _singleUpdateFeeInWei) public {
        singleUpdateFeeInWei = _singleUpdateFeeInWei;
        validTimePeriod = _validTimePeriod;
    }

    function queryPriceFeed(
        bytes32 id
    ) public view override returns (PythStructs.PriceFeed memory priceFeed) {
        assert(priceFeeds[id].id != 0);
        return priceFeeds[id];
    }

    function priceFeedExists(bytes32 id) public view override returns (bool) {
        return (priceFeeds[id].id != 0);
    }

    function getValidTimePeriod() public view override returns (uint) {
        return validTimePeriod;
    }

    // Takes an array of encoded price feeds and stores them.
    // You can create this data either by calling createPriceFeedData or
    // by using web3.js or ethers abi utilities.
    function updatePriceFeeds(
        bytes[] calldata updateData
    ) public payable override {
        uint requiredFee = getUpdateFee(updateData);
        assert(msg.value >= requiredFee);
        // Chain ID is id of the source chain that the price update comes from. Since it is just a mock contract
        // We set it to 1.
        uint16 chainId = 1;

        // for (uint i = 0; i < updateData.length; i++) {
        //     PythStructs.PriceFeed memory priceFeed = abi.decode(
        //         updateData[i],
        //         (PythStructs.PriceFeed)
        //     );
        //     uint lastPublishTime = priceFeeds[priceFeed.id].price.publishTime;

        //     //if (lastPublishTime < priceFeed.price.publishTime) {
        //     // Price information is more recent than the existing price information.
        //     priceFeeds[priceFeed.id] = priceFeed;
        //     uint256 convertedNumber = uint256(uint64(priceFeed.price.price));
        //     emit PriceFeedUpdate(
        //         priceFeed.id,
        //         uint64(lastPublishTime),
        //         priceFeed.price.price,
        //         priceFeed.price.conf
        //     );
        //     //}
        // }

        // In the real contract, the input of this function contains multiple batches that each contain multiple prices.
        // This event is emitted when a batch is processed. In this mock contract we consider there is only one batch of prices.
        // Each batch has (chainId, sequenceNumber) as it's unique identifier. Here chainId is set to 1 and an increasing sequence number is used.
        emit BatchPriceFeedUpdate(chainId, sequenceNumber);
        sequenceNumber += 1;
    }

    function getUpdateFee(
        bytes[] calldata updateData
    ) public view override returns (uint feeAmount) {
        feeAmount = singleUpdateFeeInWei * updateData.length;
        return feeAmount;
    }

    function parsePriceFeedUpdates(
        bytes[] calldata updateData,
        bytes32[] calldata priceIds,
        uint64 minPublishTime,
        uint64 maxPublishTime
    ) external payable override returns (PythStructs.PriceFeed[] memory) {
        uint requiredFee = getUpdateFee(updateData);
        assert(msg.value >= requiredFee);

        PythStructs.PriceFeed[] memory feeds = new PythStructs.PriceFeed[](priceIds.length);

        for (uint i = 0; i < priceIds.length; i++) {
            for (uint j = 0; j < updateData.length; j++) {
                feeds[i] = abi.decode(updateData[j], (PythStructs.PriceFeed));

                if (feeds[i].id == priceIds[i]) {
                    uint publishTime = feeds[i].price.publishTime;
                    if (
                        minPublishTime <= publishTime &&
                        publishTime <= maxPublishTime
                    ) {
                        break;
                    } else {
                        feeds[i].id = 0;
                    }
                }
            }

            assert(feeds[i].id == priceIds[i]);
        }
        return feeds;
    }

    function createPriceFeedUpdateData(
        bytes32 id,
        int64 price,
        uint64 conf,
        int32 expo,
        int64 emaPrice,
        uint64 emaConf,
        uint64 publishTime
    ) public pure returns (bytes memory priceFeedData) {
        PythStructs.PriceFeed memory priceFeed;

        priceFeed.id = id;

        priceFeed.price.price = price;
        priceFeed.price.conf = conf;
        priceFeed.price.expo = expo;
        priceFeed.price.publishTime = publishTime;

        priceFeed.emaPrice.price = emaPrice;
        priceFeed.emaPrice.conf = emaConf;
        priceFeed.emaPrice.expo = expo;
        priceFeed.emaPrice.publishTime = publishTime;

        priceFeedData = abi.encode(priceFeed);

        return priceFeedData;
    }

    function setNewFeedId(bytes32 id) public {
        PythStructs.PriceFeed memory priceFeed;
        priceFeed.id = id;
        priceFeeds[id] = priceFeed;
    }

    function mockPrices(
        bytes32 id,
        int64 price,
        uint64 conf,
        int32 expo,
        int64 emaPrice,
        uint64 emaConf,
        uint64 publishTime
    ) public {

        priceFeeds[id].price.price = price;
        priceFeeds[id].price.conf = conf;
        priceFeeds[id].price.expo = expo;
        priceFeeds[id].price.publishTime = publishTime;

        priceFeeds[id].emaPrice.price = emaPrice;
        priceFeeds[id].emaPrice.conf = emaConf;
        priceFeeds[id].emaPrice.expo = expo;
        priceFeeds[id].emaPrice.publishTime = publishTime;
    }

}