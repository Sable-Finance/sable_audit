// SPDX-License-Identifier: MIT

pragma solidity 0.6.11;
pragma experimental ABIEncoderV2;

import "../Interfaces/IPriceFeed.sol";
import "../Interfaces/IPyth.sol";
import "../Dependencies/console.sol";

/*
* PriceFeed placeholder for testnet and development. The price is simply set manually and saved in a state 
* variable. The contract does not connect to a live Chainlink price feed. 
*/
contract PriceFeedTestnet is IPriceFeed {
    
    uint256 private _price = 200 * 1e18;

    IPriceFeed.FetchPriceResult private _fetchPriceResult = IPriceFeed.FetchPriceResult({
        price: _price,
        oracleKey: bytes32("LINK"),
        deviationPyth: 0,
        publishTimePyth: 0
    });

    IPyth mockPyth;

    address borrowerOperationsAddress;
    address troveManagerAddress;
    address stabilityPoolAddress;

    // --- Functions ---

    // View price getter for simplicity in tests
    function getPrice() external view returns (uint256) {
        return _price;
    }

    function setAddressesTestnet(
        address _troveManagerAddress,
        address _borrowerOperationsAddress,
        address _stabilityPoolAddress
    )
        external
    {
        troveManagerAddress = _troveManagerAddress;
        borrowerOperationsAddress = _borrowerOperationsAddress;
        stabilityPoolAddress = _stabilityPoolAddress;
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

    function fetchPrice(bytes[] calldata priceFeedUpdateData) external override returns (IPriceFeed.FetchPriceResult memory) {
        _restrictCaller();
        // Fire an event just like the mainnet version would.
        // This lets the subgraph rely on events to get the latest price even when developing locally.
        emit LastGoodPriceUpdated(_price);

        return _fetchPriceResult;
    }

    // Manual external price setter.
    function setPrice(uint256 price) external returns (bool) {
        _price = price;
        _fetchPriceResult.price = _price;
        return true;
    }

    function setFetchPriceResult(uint _deviationPyth, uint _publishTimePyth, bool isPythPrice) external {
        _fetchPriceResult.price = _price;
        if (isPythPrice) {
            _fetchPriceResult.deviationPyth = _deviationPyth;
            _fetchPriceResult.publishTimePyth = _publishTimePyth;
            _fetchPriceResult.oracleKey = bytes32("PYTH");
        } else {
            _fetchPriceResult.oracleKey = bytes32("LINK");
        }        
    }

    function pyth() external view override returns (IPyth) {
        return mockPyth;
    }

    function setMockPyth(address _mockPythAddress) external {
        mockPyth = IPyth(_mockPythAddress);
    }

    receive() external payable {}
}
