// SPDX-License-Identifier: MIT

pragma solidity 0.6.11;
pragma experimental ABIEncoderV2;

import "./Interfaces/IPriceFeed.sol";
import "./Interfaces/IPyth.sol";
import "./Interfaces/PythStructs.sol";
import "./Dependencies/AggregatorV3Interface.sol";
import "./Dependencies/SafeMath.sol";
import "./Dependencies/Ownable.sol";
import "./Dependencies/CheckContract.sol";
import "./Dependencies/BaseMath.sol";
import "./Dependencies/LiquityMath.sol";
import "./Dependencies/console.sol";

/*
* PriceFeed for mainnet deployment, to be connected to Pyth network 
* contract, and Chainlink's live ETH:USD aggregator reference contract.
*
* The PriceFeed uses Pyth as primary oracle, and Chainlink as fallback. It contains logic for
* switching oracles based on oracle failures, timeouts, and conditions for returning to the primary
* Pyth oracle.
*/
contract PriceFeed is Ownable, CheckContract, BaseMath, IPriceFeed {
    using SafeMath for uint256;

    string constant public NAME = "PriceFeed";

    AggregatorV3Interface public priceAggregator;  // Mainnet Chainlink aggregator
    IPyth public override pyth;  // Wrapper contract that calls the Pyth system

    // Core Sable contracts
    address borrowerOperationsAddress;
    address troveManagerAddress;
    address stabilityPoolAddress;

    // Use to convert a price answer to an 18-digit precision uint
    uint constant public TARGET_DIGITS = 18;
    uint constant public PYTH_DIGITS = 8;

    // Maximum time period allowed since Pyth's latest data timestamp, beyond which Pyth is considered frozen.
    uint constant public TIMEOUT = 14400;  // 4 hours: 60 * 60 * 4

    // Maximum deviation allowed between two consecutive Chainlink oracle prices. 18-digit precision.
    uint constant public MAX_PRICE_DEVIATION_FROM_PREVIOUS_ROUND =  5e17; // 50%
    
    /* 
    * The maximum relative price difference between two oracle responses allowed in order for the PriceFeed
    * to return to using the Pyth oracle. 18-digit precision.
    */
    uint constant public MAX_PRICE_DIFFERENCE_BETWEEN_ORACLES = 5e16; // 5%

    // If deviationPyth > 0.25%, use Chainlink
    uint constant public MAX_SCALED_DEVIATION_PYTH = 25 * DECIMAL_PRECISION / 10000; // 0.25% * DEVIATION_PRECISION

    bytes32 public BNBFeed; // id of Pyth price feed for BNB:USD
    uint public age = 120; // seconds pyth price confidence

    // The last good price seen from an oracle by Sable
    uint public lastGoodPrice;

    struct PythResponse {
        bool success;
        uint256 pricePyth;
        uint256 deviationPyth;
        uint256 publishTimePyth;
    }

    struct ChainlinkResponse {
        uint80 roundId;
        int256 answer;
        uint256 timestamp;
        bool success;
        uint8 decimals;
    }

    enum Status {
        pythWorking,
        usingChainlinkPythUntrusted,
        bothOraclesUntrusted,
        usingChainlinkPythFrozen,
        usingPythChainlinkUntrusted
    }

    // The current status of the PricFeed, which determines the conditions for the next price fetch attempt
    Status public status;

    event LastGoodPriceUpdated(uint _lastGoodPrice);
    event PriceFeedStatusChanged(Status newStatus);

    // --- Dependency setters ---

    function _setBNBFeed(bytes32 _BNBFeed) internal {
        BNBFeed = _BNBFeed;
    }
    
    function setAddresses(
        address _priceAggregatorAddress,
        address _pythAddress,
        address _troveManagerAddress,
        address _borrowerOperationsAddress,
        address _stabilityPoolAddress,
        bytes32 _bnbFeedPyth,
        bytes[] calldata priceFeedUpdateData
    )
        external
        payable
        onlyOwner
    {
        checkContract(_priceAggregatorAddress);
        checkContract(_pythAddress);
        checkContract(_troveManagerAddress);
        checkContract(_borrowerOperationsAddress);
        checkContract(_stabilityPoolAddress);

        troveManagerAddress = _troveManagerAddress;
        borrowerOperationsAddress = _borrowerOperationsAddress;
        stabilityPoolAddress = _stabilityPoolAddress;
       
        priceAggregator = AggregatorV3Interface(_priceAggregatorAddress);
        pyth = IPyth(_pythAddress);

        // Explicitly set initial system status
        status = Status.pythWorking;

        _setBNBFeed(_bnbFeedPyth);

        // Get an initial price from Pyth to serve as first reference for lastGoodPrice
        PythResponse memory pythResponse = _getCurrentPythResponse(priceFeedUpdateData);
        require(
            !_pythResponseFailed(pythResponse) && !_pythIsFrozen(pythResponse),
            "PriceFeed: Pyth must be working and current"
        );

         _storePythPrice(pythResponse);

        _renounceOwnership();
    }

    function _restrictCaller() internal view {
        require(
            msg.sender == address(this)
            || msg.sender == troveManagerAddress 
            || msg.sender == borrowerOperationsAddress
            || msg.sender == stabilityPoolAddress,
            "PriceFeed: Only restricted contract can call fetchPrice"
        );
    }

    // --- Functions ---

    /*
    * fetchPrice():
    * Returns the latest price obtained from the Oracle. Called by Sable functions that require a current price.
    *
    * Also callable by anyone externally.
    *
    * Non-view function - it stores the last good price seen by Sable.
    *
    * Uses a main oracle (Pyth) and a fallback oracle (Chainlink) in case Pyth fails. If both fail, 
    * it uses the last good price seen by Sable.
    *
    */
    function fetchPrice(
        bytes[] calldata priceFeedUpdateData
    ) external override returns (FetchPriceResult memory result) {
        _restrictCaller();
        // Get current and previous price data from Pyth, and current price data from Chainlink
        ChainlinkResponse memory chainlinkResponse = _getCurrentChainlinkResponse();
        ChainlinkResponse memory prevChainlinkResponse = _getPrevChainlinkResponse(chainlinkResponse.roundId, chainlinkResponse.decimals);
        PythResponse memory pythResponse = _getCurrentPythResponse(priceFeedUpdateData);

        result.price = 0;
        result.deviationPyth = 0;
        result.publishTimePyth = 0;
        result.oracleKey = bytes32("PYTH");

        // --- CASE 1: System fetched last price from Pyth  ---
        if (status == Status.pythWorking) {
            // If Pyth is broken, try Chainlink
            if (_pythIsBroken(pythResponse)) {
                // If Chainlink is broken then both oracles are untrusted, so return the last good price
                if (_chainlinkIsBroken(chainlinkResponse, prevChainlinkResponse)) {
                    _changeStatus(Status.bothOraclesUntrusted);
                    result.price = lastGoodPrice; 
                }
                /*
                * If Chainlink is only frozen but otherwise returning valid data, return the last good price.
                */
                else if (_chainlinkIsFrozen(chainlinkResponse)) {
                    _changeStatus(Status.usingChainlinkPythUntrusted);
                    result.price = lastGoodPrice;
                    result.oracleKey = bytes32("LINK");
                }

                else {
                    // If Pyth is broken and Chainlink is working, switch to Chainlink and return current Chainlink price
                    _changeStatus(Status.usingChainlinkPythUntrusted);
                    result.price = _storeChainlinkPrice(chainlinkResponse);
                    result.oracleKey = bytes32("LINK");
                }
                
            }

            // If Pyth is frozen, try Chainlink
            else if (_pythIsFrozen(pythResponse)) {          
                // If Chainlink is broken too, remember Chainlink broke, and return last good price
                if (_chainlinkIsBroken(chainlinkResponse, prevChainlinkResponse)) {
                    _changeStatus(Status.usingPythChainlinkUntrusted);
                    result.price = lastGoodPrice;    
                } else {
                    // If Chainlink is frozen or working, remember Pyth froze, and switch to Chainlink
                    _changeStatus(Status.usingChainlinkPythFrozen);
                    result.oracleKey = bytes32("LINK");
                
                    if (_chainlinkIsFrozen(chainlinkResponse)) {
                        result.price = lastGoodPrice;
                    } else {
                        // If Chainlink is working, use it
                        result.price = _storeChainlinkPrice(chainlinkResponse);
                    }
                }
            }

            // If Pyth is working
            else {
                // If Pyth is working and Chainlink is broken, remember Chainlink is broken
                if (_chainlinkIsBroken(chainlinkResponse, prevChainlinkResponse)) {
                    _changeStatus(Status.usingPythChainlinkUntrusted);    
                } 

                // If Pyth is working, return Pyth current price (no status change)
                result.price = _storePythPrice(pythResponse);
                result.deviationPyth = pythResponse.deviationPyth;
                result.publishTimePyth = pythResponse.publishTimePyth;
            }

        }

        // --- CASE 2: The system fetched last price from Chainlink --- 
        if (status == Status.usingChainlinkPythUntrusted) { 
            // If both Chainlink and Pyth are live, unbroken, and reporting similar prices, switch back to Pyth
            if (_bothOraclesLiveAndUnbrokenAndSimilarPrice(chainlinkResponse, prevChainlinkResponse, pythResponse)) {
                _changeStatus(Status.pythWorking);
                result.price = _storePythPrice(pythResponse);
                result.oracleKey = bytes32("PYTH");
                result.deviationPyth = pythResponse.deviationPyth;
                result.publishTimePyth = pythResponse.publishTimePyth;
            }

            else if (_chainlinkIsBroken(chainlinkResponse, prevChainlinkResponse)) {
                _changeStatus(Status.bothOraclesUntrusted);
                result.price = lastGoodPrice; 
            }

            /*
            * If Chainlink is only frozen but otherwise returning valid data, just return the last good price.
            */
            else if (_chainlinkIsFrozen(chainlinkResponse)) {result.price = lastGoodPrice;}
            
            // Otherwise, use Chainlink price
            else {
                // If Chainlink is live but deviated >50% from it's previous price and Pyth is still untrusted, switch 
                // to bothOraclesUntrusted and return last good price
                if (_chainlinkPriceChangeAboveMax(chainlinkResponse, prevChainlinkResponse)) {
                    _changeStatus(Status.bothOraclesUntrusted);
                    result.price = lastGoodPrice;
                } else {
                    result.price = _storeChainlinkPrice(chainlinkResponse);
                    result.oracleKey = bytes32("LINK");
                }
            }
        }

        // --- CASE 3: Both oracles were untrusted at the last price fetch ---
        if (status == Status.bothOraclesUntrusted) {
            /*
            * If both oracles are now live, unbroken and similar price, we assume that they are reporting
            * accurately, and so we switch back to Pyth.
            */
            if (_bothOraclesLiveAndUnbrokenAndSimilarPrice(chainlinkResponse, prevChainlinkResponse, pythResponse)) {
                _changeStatus(Status.pythWorking);
                result.oracleKey = bytes32("PYTH");
                result.price = _storePythPrice(pythResponse);
                result.deviationPyth = pythResponse.deviationPyth;
                result.publishTimePyth = pythResponse.publishTimePyth;
            } else {
                // Otherwise, return the last good price - both oracles are still untrusted (no status change)
                result.price = lastGoodPrice;
            }
            
        }

        // --- CASE 4: Using Chainlink, and Pyth is frozen ---
        if (status == Status.usingChainlinkPythFrozen) {
            if (_pythIsBroken(pythResponse)) {
                // If both Oracles are broken, return last good price
                if (_chainlinkIsBroken(chainlinkResponse, prevChainlinkResponse)) {
                    _changeStatus(Status.bothOraclesUntrusted);
                    result.price = lastGoodPrice;
                } else {
                    // If Pyth is broken, remember it and switch to using Chainlink
                    _changeStatus(Status.usingChainlinkPythUntrusted);
                    result.oracleKey = bytes32("LINK");

                    if (_chainlinkIsFrozen(chainlinkResponse)) {
                        result.price = lastGoodPrice;
                    } else {
                        // If Chainlink is live but deviated >50% from it's previous price and Pyth is still untrusted, switch 
                        // to bothOraclesUntrusted and return last good price
                        if (_chainlinkPriceChangeAboveMax(chainlinkResponse, prevChainlinkResponse)) {
                            _changeStatus(Status.bothOraclesUntrusted);
                            result.price = lastGoodPrice;
                        } else {
                            result.price = _storeChainlinkPrice(chainlinkResponse);
                        }
                    }
                }
            }

            else if (_pythIsFrozen(pythResponse)) {
                // if Pyth is frozen and Chainlink is broken, remember Chainlink broke, and return last good price
                if (_chainlinkIsBroken(chainlinkResponse, prevChainlinkResponse)) {
                    _changeStatus(Status.usingPythChainlinkUntrusted);
                    result.oracleKey = bytes32("PYTH");
                    result.price = lastGoodPrice;
                }

                // If both are frozen, just use lastGoodPrice
                else if (_chainlinkIsFrozen(chainlinkResponse)) {
                    result.price = lastGoodPrice;
                }

                else {
                    // If Chainlink is live but deviated >50% from it's previous price and Pyth is still untrusted, switch 
                    // to bothOraclesUntrusted and return last good price
                    if (_chainlinkPriceChangeAboveMax(chainlinkResponse, prevChainlinkResponse)) {
                        _changeStatus(Status.bothOraclesUntrusted);
                        result.price = lastGoodPrice;
                    } else {
                        // if Pyth is frozen and Chainlink is working, keep using Chainlink (no status change)
                        result.price = _storeChainlinkPrice(chainlinkResponse);
                        result.oracleKey = bytes32("LINK");
                    }
                }
                
            }

            // if Pyth is live and Chainlink is broken, remember Chainlink broke, and return Pyth price
            else if (_chainlinkIsBroken(chainlinkResponse, prevChainlinkResponse)) {
                _changeStatus(Status.usingPythChainlinkUntrusted);
                result.oracleKey = bytes32("PYTH");
                result.price = _storePythPrice(pythResponse);
                result.deviationPyth = pythResponse.deviationPyth;
                result.publishTimePyth = pythResponse.publishTimePyth;
            }

             // If Pyth is live and Chainlink is frozen, just use last good price (no status change) since we have no basis for comparison
            else if (_chainlinkIsFrozen(chainlinkResponse)) {
                result.price = lastGoodPrice;
            }

            // If Pyth is live and Chainlink is working, compare prices. Switch to Pyth
            // if prices are within 5%, and return Pyth price.
            else if (_bothOraclesSimilarPrice(chainlinkResponse, pythResponse)) {
                _changeStatus(Status.pythWorking);
                result.oracleKey = bytes32("PYTH");
                result.price = _storePythPrice(pythResponse);
                result.deviationPyth = pythResponse.deviationPyth;
                result.publishTimePyth = pythResponse.publishTimePyth;
            } 
            
            else {
                // Otherwise if Pyth is live but price not within 5% of Chainlink, distrust Pyth, and return Chainlink price
                
                // If Chainlink is live but deviated >50% from it's previous price and Pyth is still untrusted, switch 
                // to bothOraclesUntrusted and return last good price
                if (_chainlinkPriceChangeAboveMax(chainlinkResponse, prevChainlinkResponse)) {
                    _changeStatus(Status.bothOraclesUntrusted);
                    result.price = lastGoodPrice;
                } else {
                    // if Pyth is frozen and Chainlink is working, keep using Chainlink (no status change)
                    result.price = _storeChainlinkPrice(chainlinkResponse);
                    _changeStatus(Status.usingChainlinkPythUntrusted);
                    result.oracleKey = bytes32("LINK");
                }
            }

        }

        // --- CASE 5: Using Pyth, Chainlink is untrusted ---
        if (status == Status.usingPythChainlinkUntrusted) {
            // If Pyth breaks, now both oracles are untrusted
            if (_pythIsBroken(pythResponse)) {
                _changeStatus(Status.bothOraclesUntrusted);
                result.price = lastGoodPrice;
            }

            // If Pyth is frozen, return last good price (no status change)
            else if (_pythIsFrozen(pythResponse)) {
                result.price = lastGoodPrice;
            }

            // If Pyth and Chainlink are both live, unbroken and similar price, switch back to Pyth and return Pyth price
            else if (_bothOraclesLiveAndUnbrokenAndSimilarPrice(chainlinkResponse, prevChainlinkResponse, pythResponse)) {
                _changeStatus(Status.pythWorking);
                result.price = _storePythPrice(pythResponse);
                result.deviationPyth = pythResponse.deviationPyth;
                result.publishTimePyth = pythResponse.publishTimePyth;
            }

            else {
                // return Pyth price (no status change)
                result.price = _storePythPrice(pythResponse);
                result.deviationPyth = pythResponse.deviationPyth;
                result.publishTimePyth = pythResponse.publishTimePyth;
            }
        }

    }

    // --- Helper functions ---

    // Chainlink is considered broken if its current or previous round data is in any way bad
    function _chainlinkIsBroken(ChainlinkResponse memory _currentResponse, ChainlinkResponse memory _prevResponse) internal view returns (bool) {
        return _badChainlinkResponse(_currentResponse) || _badChainlinkResponse(_prevResponse);
    }

    function _badChainlinkResponse(ChainlinkResponse memory _response) internal view returns (bool) {
         // Check for response call reverted
        if (!_response.success) {return true;}
        // Check for an invalid roundId that is 0
        if (_response.roundId == 0) {return true;}
        // Check for an invalid timeStamp that is 0, or in the future
        if (_response.timestamp == 0 || _response.timestamp > block.timestamp) {return true;}
        // Check for non-positive price
        if (_response.answer <= 0) {return true;}

        return false;
    }

    function _chainlinkIsFrozen(ChainlinkResponse memory _response) internal view returns (bool) {
        return block.timestamp.sub(_response.timestamp) > TIMEOUT;
    }

    function _chainlinkPriceChangeAboveMax(ChainlinkResponse memory _currentResponse, ChainlinkResponse memory _prevResponse) internal pure returns (bool) {
        uint currentScaledPrice = _scaleChainlinkPriceByDigits(uint256(_currentResponse.answer), _currentResponse.decimals);
        uint prevScaledPrice = _scaleChainlinkPriceByDigits(uint256(_prevResponse.answer), _prevResponse.decimals);

        uint minPrice = LiquityMath._min(currentScaledPrice, prevScaledPrice);
        uint maxPrice = LiquityMath._max(currentScaledPrice, prevScaledPrice);

        /*
        * Use the larger price as the denominator:
        * - If price decreased, the percentage deviation is in relation to the the previous price.
        * - If price increased, the percentage deviation is in relation to the current price.
        */
        uint percentDeviation = maxPrice.sub(minPrice).mul(DECIMAL_PRECISION).div(maxPrice);

        // Return true if price has more than doubled, or more than halved.
        return percentDeviation > MAX_PRICE_DEVIATION_FROM_PREVIOUS_ROUND;
    }

    function _pythIsBroken(PythResponse memory _response) internal view returns (bool) {
        // Check for response call reverted
        if (!_response.success) {return true;}

        // Check for an invalid publishTimePyth that is 0
        if (_response.publishTimePyth == 0) {return true;}

        // If the publishTimePyth - block.timestamp > 5, use Chainlink.
        if (_response.publishTimePyth > block.timestamp) {
            if (_response.publishTimePyth.sub(block.timestamp) > 5) {return true;}
        }
        
        // Check for zero price
        if (_response.pricePyth <= 0) {return true;}

        // If deviationPyth > 0.25%, use Chainlink
        if (_response.deviationPyth > MAX_SCALED_DEVIATION_PYTH) {return true;}

        return false;
    }

    function _pythResponseFailed(PythResponse memory _response) internal pure returns (bool) {
        // Check for response call reverted
        if (!_response.success) {return true;}

        // Check for an invalid publishTimePyth that is 0
        if (_response.publishTimePyth == 0) {return true;}

        // Check for zero price
        if (_response.pricePyth <= 0) {return true;}

        return false;
    }

     function _pythIsFrozen(PythResponse  memory _pythResponse) internal view returns (bool) {
        // If the block.timestamp - publishTimePyth > 30, use Chainlink.
        if (block.timestamp > _pythResponse.publishTimePyth) {
            return block.timestamp.sub(_pythResponse.publishTimePyth) > 30;
        }
    }

    function _bothOraclesLiveAndUnbrokenAndSimilarPrice
    (
        ChainlinkResponse memory _chainlinkResponse,
        ChainlinkResponse memory _prevChainlinkResponse,
        PythResponse memory _pythResponse
    )
        internal
        view
        returns (bool)
    {
        // Return false if either oracle is broken or frozen
        if
        (
            _pythIsBroken(_pythResponse) ||
            _pythIsFrozen(_pythResponse) ||
            _chainlinkIsBroken(_chainlinkResponse, _prevChainlinkResponse) ||
            _chainlinkIsFrozen(_chainlinkResponse)
        )
        {
            return false;
        }

        return _bothOraclesSimilarPrice(_chainlinkResponse, _pythResponse);
    }

    function _bothOraclesSimilarPrice( ChainlinkResponse memory _chainlinkResponse, PythResponse memory _pythResponse) internal pure returns (bool) {
        uint scaledChainlinkPrice = _scaleChainlinkPriceByDigits(uint256(_chainlinkResponse.answer), _chainlinkResponse.decimals);
        uint scaledPythPrice = _pythResponse.pricePyth;

        // Get the relative price difference between the oracles. Use the lower price as the denominator, i.e. the reference for the calculation.
        uint minPrice = LiquityMath._min(scaledPythPrice, scaledChainlinkPrice);
        uint maxPrice = LiquityMath._max(scaledPythPrice, scaledChainlinkPrice);
        uint percentPriceDifference = maxPrice.sub(minPrice).mul(DECIMAL_PRECISION).div(minPrice);

        /*
        * Return true if the relative price difference is <= 5%: if so, we assume both oracles are probably reporting
        * the honest market price, as it is unlikely that both have been broken/hacked and are still in-sync.
        */
        return percentPriceDifference <= MAX_PRICE_DIFFERENCE_BETWEEN_ORACLES;
    }

    function _scaleChainlinkPriceByDigits(uint _price, uint _answerDigits) internal pure returns (uint) {
        /*
        * Convert the price returned by the Chainlink oracle to an 18-digit decimal for use by Sable.
        * At date of Sable launch, Chainlink uses an 8-digit price, but we also handle the possibility of
        * future changes.
        *
        */
        uint price;
        if (_answerDigits >= TARGET_DIGITS) {
            // Scale the returned price value down to Sable's target precision
            price = _price.div(10 ** (_answerDigits - TARGET_DIGITS));
        }
        else if (_answerDigits < TARGET_DIGITS) {
            // Scale the returned price value up to Sable's target precision
            price = _price.mul(10 ** (TARGET_DIGITS - _answerDigits));
        }
        return price;
    }

    function _scalePythPrice(
        PythStructs.Price memory price,
        uint8 targetDecimals
    ) internal pure returns (uint256) {
        if (price.price < 0 || price.expo > 0 || price.expo < -255) {
            // revert();
            return 0;
        }

        uint8 priceDecimals = uint8(uint32(-1 * price.expo));

        if (targetDecimals - priceDecimals >= 0) {
            return
                uint(price.price) *
                (uint(10) ** uint(targetDecimals - priceDecimals));
        } else {
            return
                uint(price.price) /
                (uint(10) ** uint(priceDecimals - targetDecimals));
        }
    }

    function _changeStatus(Status _status) internal {
        status = _status;
        emit PriceFeedStatusChanged(_status);
    }

    function _storePrice(uint _currentPrice) internal {
        lastGoodPrice = _currentPrice;
        emit LastGoodPriceUpdated(_currentPrice);
    }

     function _storePythPrice(PythResponse memory _pythResponse) internal returns (uint) {
        _storePrice(_pythResponse.pricePyth);

        return _pythResponse.pricePyth;
    }

    function _storeChainlinkPrice(ChainlinkResponse memory _chainlinkResponse) internal returns (uint) {
        uint scaledChainlinkPrice = _scaleChainlinkPriceByDigits(uint256(_chainlinkResponse.answer), _chainlinkResponse.decimals);
        _storePrice(scaledChainlinkPrice);

        return scaledChainlinkPrice;
    }

    // --- Oracle response wrapper functions ---

    function _getCurrentPythResponse(
        bytes[] calldata priceFeedUpdateData
    ) internal returns (PythResponse memory pythResponse) {
        uint updateFee = pyth.getUpdateFee(priceFeedUpdateData);
        pyth.updatePriceFeeds{value: updateFee}(priceFeedUpdateData);

        try pyth.getPriceNoOlderThan(BNBFeed, age) returns (PythStructs.Price memory bnbPrice) {
            pythResponse.pricePyth = _scalePythPrice(bnbPrice, 18);
            uint256 scaledConfidenceInterval = uint(bnbPrice.conf) * DECIMAL_PRECISION;
            if (pythResponse.pricePyth != 0) {
                pythResponse.deviationPyth = scaledConfidenceInterval / uint(bnbPrice.price) / 100;
            }
            pythResponse.publishTimePyth = bnbPrice.publishTime;
            if (pythResponse.pricePyth != 0 && pythResponse.publishTimePyth != 0) {
                pythResponse.success = true;
            }
        } catch {
            return pythResponse;
        }
    }

    function _getCurrentChainlinkResponse() internal view returns (ChainlinkResponse memory chainlinkResponse) {
        // First, try to get current decimal precision:
        try priceAggregator.decimals() returns (uint8 decimals) {
            // If call to Chainlink succeeds, record the current decimal precision
            chainlinkResponse.decimals = decimals;
        } catch {
            // If call to Chainlink aggregator reverts, return a zero response with success = false
            return chainlinkResponse;
        }

        // Secondly, try to get latest price data:
        try priceAggregator.latestRoundData() returns
        (
            uint80 roundId,
            int256 answer,
            uint256 /* startedAt */,
            uint256 timestamp,
            uint80 /* answeredInRound */
        )
        {
            // If call to Chainlink succeeds, return the response and success = true
            chainlinkResponse.roundId = roundId;
            chainlinkResponse.answer = answer;
            chainlinkResponse.timestamp = timestamp;
            chainlinkResponse.success = true;
            return chainlinkResponse;
        } catch {
            // If call to Chainlink aggregator reverts, return a zero response with success = false
            return chainlinkResponse;
        }
    }

    function _getPrevChainlinkResponse(uint80 _currentRoundId, uint8 _currentDecimals) internal view returns (ChainlinkResponse memory prevChainlinkResponse) {
        /*
        * NOTE: Chainlink only offers a current decimals() value - there is no way to obtain the decimal precision used in a 
        * previous round.  We assume the decimals used in the previous round are the same as the current round.
        */

        // Try to get the price data from the previous round:
        try priceAggregator.getRoundData(_currentRoundId - 1) returns 
        (
            uint80 roundId,
            int256 answer,
            uint256 /* startedAt */,
            uint256 timestamp,
            uint80 /* answeredInRound */
        )
        {
            // If call to Chainlink succeeds, return the response and success = true
            prevChainlinkResponse.roundId = roundId;
            prevChainlinkResponse.answer = answer;
            prevChainlinkResponse.timestamp = timestamp;
            prevChainlinkResponse.decimals = _currentDecimals;
            prevChainlinkResponse.success = true;
            return prevChainlinkResponse;
        } catch {
            // If call to Chainlink aggregator reverts, return a zero response with success = false
            return prevChainlinkResponse;
        }
    }

    receive() external payable {}
}
