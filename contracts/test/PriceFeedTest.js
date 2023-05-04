
const PriceFeed = artifacts.require("./PriceFeedTester.sol")
const PriceFeedTestnet = artifacts.require("./PriceFeedTestnet.sol")
const MockChainlink = artifacts.require("./MockAggregator.sol")
const MockPyth = artifacts.require("./MockPyth.sol");
const OracleRateCalculation = artifacts.require("./OracleRateCalculation.sol");
const BorrowerOperations = artifacts.require("./BorrowerOperations.sol");
const TroveManager = artifacts.require("./TroveManager.sol");
const StabilityPool = artifacts.require("./StabilityPool.sol");

const testHelpers = require("../utils/testHelpers.js")
const th = testHelpers.TestHelper

const DEFAULT_PRICE_FEED_DATA = testHelpers.DEFAULT_PRICE_FEED_DATA

const { dec, assertRevert, toBN } = th
const { defaultAbiCoder, Interface } = require("@ethersproject/abi");

const PYTH_FROZEN_TIME = 30;
const CHAINLINK_FROZEN_TIME = 14400; // 4 hours
const AGE = 120; // 120 seconds for get pyth price

contract('PriceFeed', async accounts => {

  const [owner, alice, bob, funder] = accounts;
  let priceFeedTestnet
  let priceFeed
  let zeroAddressPriceFeed
  let mockChainlink
  let mockPyth
  let oracleCalc
  let troveManager
  let borrowerOperations
  let stabilityPool

  const PRICE_ID = "0xecf553770d9b10965f8fb64771e93f5690a182edc32be4a3236e0caaa6e0581a"
  const ZERO_ADDRESS = "0x".concat("0".repeat(40))

  const setAddresses = async () => {
    await priceFeed.setAddressesTestnet(
      mockChainlink.address, 
      mockPyth.address, 
      troveManager.address,
      borrowerOperations.address,
      alice,
      PRICE_ID, 
      { from: owner }
    )
  }

  beforeEach(async () => {
    priceFeedTestnet = await PriceFeedTestnet.new()
    PriceFeedTestnet.setAsDeployed(priceFeedTestnet)

    priceFeed = await PriceFeed.new()
    PriceFeed.setAsDeployed(priceFeed)

    zeroAddressPriceFeed = await PriceFeed.new()
    PriceFeed.setAsDeployed(zeroAddressPriceFeed)

    mockChainlink = await MockChainlink.new()
    MockChainlink.setAsDeployed(mockChainlink)

    mockPyth = await MockPyth.new(0, 1)
    MockPyth.setAsDeployed(mockPyth)

    oracleCalc = await OracleRateCalculation.new();
    OracleRateCalculation.setAsDeployed(oracleCalc);

    borrowerOperations = await BorrowerOperations.new();
    troveManager = await TroveManager.new();
    stabilityPool = await StabilityPool.new();

    await mockPyth.setNewFeedId(PRICE_ID)

    // Set Pyth latest and prev round Id's to non-zero
    await mockChainlink.setLatestRoundId(3)
    await mockChainlink.setPrevRoundId(2)

    //Set current and prev prices in both oracles
    await mockChainlink.setPrice(dec(100, 18))
    await mockChainlink.setPrevPrice(dec(100, 18))

    // Set mock price updateTimes in both oracles to very recent
    const now = await th.getLatestBlockTimestamp(web3)
    await mockChainlink.setUpdateTime(now)

    // funding PriceFeed contract
    await web3.eth.sendTransaction({from: funder, to: priceFeed.address, value: 1000000000})
    await web3.eth.sendTransaction({from: funder, to: priceFeedTestnet.address, value: 1000000000})
  })

  describe('PriceFeed internal testing contract', async accounts => {
    it("fetchPrice before setPrice should return the default price", async () => {
      const price = await priceFeedTestnet.getPrice()
      assert.equal(price, dec(200, 18))
    })
    it("should be able to fetchPrice after setPrice, output of former matching input of latter", async () => {
      await priceFeedTestnet.setPrice(dec(100, 18))
      const price = await priceFeedTestnet.getPrice()
      assert.equal(price, dec(100, 18))
    })
  })

  describe('Mainnet PriceFeed setup', async accounts => {

    it("setAddresses should fail whe called by nonOwner", async () => {
      await assertRevert(
        priceFeed.setAddressesTestnet(
          mockChainlink.address, 
          mockPyth.address, 
          troveManager.address, 
          borrowerOperations.address, 
          stabilityPool.address, 
          PRICE_ID, 
          { from: alice }
        ),
        "Ownable: caller is not the owner"
      )
    })

    it("setAddresses should fail after address has already been set", async () => {
      // Owner can successfully set any address
      const txOwner = await priceFeed.setAddressesTestnet(
        mockChainlink.address, 
        mockPyth.address,
        troveManager.address, 
        borrowerOperations.address, 
        stabilityPool.address,
        PRICE_ID, 
        { from: owner }
      )
      assert.isTrue(txOwner.receipt.status)

      await assertRevert(
        priceFeed.setAddressesTestnet(
          mockChainlink.address, 
          mockPyth.address, 
          troveManager.address, 
          borrowerOperations.address, 
          stabilityPool.address,
          PRICE_ID, 
          { from: owner }
        ),
        "Ownable: caller is not the owner"
      )

      await assertRevert(
        priceFeed.setAddressesTestnet(
          mockChainlink.address, 
          mockPyth.address, 
          troveManager.address, 
          borrowerOperations.address, 
          stabilityPool.address,
          PRICE_ID, 
          { from: alice }
        ),
        "Ownable: caller is not the owner"
      )
    })
  })

  it("Only restricted account can call fetchPrice", async () => {
    await setAddresses();

    await assertRevert(
      priceFeed.fetchPrice(DEFAULT_PRICE_FEED_DATA, { from: bob }),
      "PriceFeed: Only restricted contract can call fetchPrice"
    )

    try {
      const tx = await priceFeed.fetchPrice(DEFAULT_PRICE_FEED_DATA, { from: alice })
      assert.isTrue(tx.receipt.status)
    } catch (err) {
      assert.include(err.message, "revert")
    }
  });

  it("C1 Pyth working: fetchPriceResult should return correct results", async () => {
    await setAddresses()

    // create update pyth data
    
    let now = await th.getLatestBlockTimestamp(web3)

    // Oracle price is 10.00000000
    let mockPrice = dec(1, 9)
    await mockPyth.mockPrices(PRICE_ID, BigInt(mockPrice), 0, -8, BigInt(mockPrice), 0, BigInt(now))

    await priceFeed.logPythFetchPriceResult(DEFAULT_PRICE_FEED_DATA)
    let fetchPriceResult = await priceFeed.getInternalFetchPriceResult();
    const oracleKey = web3.utils.hexToAscii(fetchPriceResult.oracleKey);
    assert.isTrue(oracleKey.toString().includes("PYTH"));

    // deviation = Confidence interval / Price = 0 / 10^9
    assert.equal(Number(fetchPriceResult.deviationPyth), Number(0))

    let current = await th.getLatestBlockTimestamp(web3)

    let oracleRate = await oracleCalc.getOracleRate(fetchPriceResult.oracleKey, fetchPriceResult.deviationPyth, fetchPriceResult.publishTimePyth);
    // oracleRate = deviationPyth + abs(block.timestamp - publishTimePyth) * 0.01% = 0 + 2 * 10^18 * 0.01% = 2 * 10%14
    assert.equal(oracleRate.toString(), dec(2, 14))
    
  })

  it("C1 Pyth working: fetchPrice should return the correct price, taking into account the number of decimal digits on the aggregator", async () => {
    await setAddresses()

    // create update pyth data
    
    const now = await th.getLatestBlockTimestamp(web3)

    // Oracle price price is 10.00000000
    let mockPrice = dec(1, 9)
    await mockPyth.mockPrices(PRICE_ID, BigInt(mockPrice), 0, -8, BigInt(mockPrice), 0, BigInt(now))

    await priceFeed.fetchPrice(DEFAULT_PRICE_FEED_DATA, { from: alice })
    let price = await priceFeed.lastGoodPrice()
    // Check Sable PriceFeed gives 10, with 18 digit precision
    assert.equal(price.toString(), dec(10, 18))

    // Oracle price is 1e9
    await mockPyth.mockPrices(PRICE_ID, BigInt(mockPrice), 0, 0, BigInt(mockPrice), 0, BigInt(now))

    await priceFeed.fetchPrice(DEFAULT_PRICE_FEED_DATA, { from: alice })
    price = await priceFeed.lastGoodPrice()
    // Check Sable PriceFeed gives 1e9, with 18 digit precision
    assert.isTrue(price.eq(toBN(dec(1, 27))))

    // Oracle price is 0.0001
    mockPrice = dec(1, 14)
    await mockPyth.mockPrices(PRICE_ID, BigInt(mockPrice), 0, -18, BigInt(mockPrice), 0, BigInt(now)) 
    await priceFeed.fetchPrice(DEFAULT_PRICE_FEED_DATA, { from: alice })
    price = await priceFeed.lastGoodPrice()
    // Check Sable PriceFeed gives 0.0001 with 18 digit precision
    assert.isTrue(price.eq(toBN(dec(1, 14))))

    // Oracle price is 1234.56789
    mockPrice = dec(123456789)
    await mockPyth.mockPrices(PRICE_ID, BigInt(mockPrice), 0, -5, BigInt(mockPrice), 0, BigInt(now))
    await priceFeed.fetchPrice(DEFAULT_PRICE_FEED_DATA, { from: alice })
    price = await priceFeed.lastGoodPrice()
    // Check Sable PriceFeed gives 0.0001 with 18 digit precision
    assert.equal(price, '1234567890000000000000')
  })

  // --- Pyth breaks ---
  it("C1 Pyth breaks, Chainlink working: fetchPrice should return the correct Chainlink price, taking into account Chainlink's 6-digit granularity", async () => {
    await setAddresses()
    // --- Pyth fails, system switches to Chainlink ---
    const statusBefore = await priceFeed.status()
    assert.equal(statusBefore, '0') // status 0: Pyth working

    // Pyth breaks with negative price
    let mockPrice = "-5000"
    let now = await th.getLatestBlockTimestamp(web3)
    await mockPyth.mockPrices(PRICE_ID, mockPrice, 0, -8, mockPrice, 0, now)

    // Chainlink price is 123 at 6-digit precision
    await mockChainlink.setDecimals(6)
    await mockChainlink.setPrevPrice(dec(123, 6))
    await mockChainlink.setPrice(dec(123, 6))

    const priceFetchTx = await priceFeed.fetchPrice(DEFAULT_PRICE_FEED_DATA, { from: alice })
    const statusAfter = await priceFeed.status()
    assert.equal(statusAfter, '1') // status 1: using Chainlink, Pyth untrusted

    let price = await priceFeed.lastGoodPrice()
    assert.equal(price.toString(), dec(123, 18))

    // Chainlink price is 10 at 6-digit precision
    await mockChainlink.setPrice(dec(10, 6))
    await mockChainlink.setPrevPrice(dec(10, 6))
    await priceFeed.fetchPrice(DEFAULT_PRICE_FEED_DATA, { from: alice })
    price = await priceFeed.lastGoodPrice()
    // Check Sable PriceFeed gives 10, with 18 digit precision
    assert.equal(price.toString(), dec(10, 18))

    // Chainlink price is 1e9 at 6-digit precision
    await mockChainlink.setPrice(dec(1, 15))
    await mockChainlink.setPrevPrice(dec(1, 15))
    await priceFeed.fetchPrice(DEFAULT_PRICE_FEED_DATA, { from: alice })
    price = await priceFeed.lastGoodPrice()
    // Check Sable PriceFeed gives 1e9, with 18 digit precision
    assert.equal(price.toString(), dec(1, 27))

    // Chainlink price is 0.0001 at 6-digit precision
    await mockChainlink.setPrice(100)
    await mockChainlink.setPrevPrice(100)
    await priceFeed.fetchPrice(DEFAULT_PRICE_FEED_DATA, { from: alice })
    price = await priceFeed.lastGoodPrice()
    // Check Sable PriceFeed gives 0.0001 with 18 digit precision

    assert.equal(price.toString(), dec(1, 14))

    // Chainlink price is 1234.56789 at 6-digit precision
    await mockChainlink.setPrice(dec(1234567890))
    await mockChainlink.setPrevPrice(dec(1234567890))
    await priceFeed.fetchPrice(DEFAULT_PRICE_FEED_DATA, { from: alice })
    price = await priceFeed.lastGoodPrice()
    // Check Sable PriceFeed gives 0.0001 with 18 digit precision
    assert.equal(price.toString(), '1234567890000000000000')
  })

  it("C1 pythWorking: Pyth broken by zero latest fetch, Chainlink working: switch to usingChainlinkPythUntrusted", async () => {
    await setAddresses()
    const statusBefore = await priceFeed.status()
    assert.equal(statusBefore, '0') // status 0: Pyth working

    const now = await th.getLatestBlockTimestamp(web3)
    let mockPrice = dec(999, 8)
    await mockPyth.mockPrices(PRICE_ID, BigInt(mockPrice), 0, -8, BigInt(mockPrice), 0, BigInt(now))

    await priceFeed.setLastGoodPrice(dec(999, 18))

    await mockChainlink.setPrevPrice(dec(123, 6))
    await mockChainlink.setPrice(dec(123, 6))

    mockPrice = 0
    await mockPyth.mockPrices(PRICE_ID, BigInt(mockPrice), 0, -8, BigInt(mockPrice), 0, BigInt(now))

    const priceFetchTx = await priceFeed.fetchPrice(DEFAULT_PRICE_FEED_DATA, { from: alice })
    const statusAfter = await priceFeed.status()
    assert.equal(statusAfter, '1') // status 1: using Chainlink, Pyth untrusted
  })

  it("C1 pythWorking: Pyth broken by zero latest fetch, Chainlink working: use Chainlink price", async () => {
    await setAddresses()
    const statusBefore = await priceFeed.status()
    assert.equal(statusBefore, '0') // status 0: Pyth working

    const now = await th.getLatestBlockTimestamp(web3)
    let mockPrice = dec(999, 8)
    await mockPyth.mockPrices(PRICE_ID, BigInt(mockPrice), 0, -8, BigInt(mockPrice), 0, BigInt(now))
    await priceFeed.setLastGoodPrice(dec(999, 18))

    await mockChainlink.setDecimals(6)
    await mockChainlink.setPrevPrice(dec(123, 6))
    await mockChainlink.setPrice(dec(123, 6))
    
    mockPrice = 0
    await mockPyth.mockPrices(PRICE_ID, BigInt(mockPrice), 0, -8, BigInt(mockPrice), 0, BigInt(now))

    const priceFetchTx = await priceFeed.fetchPrice(DEFAULT_PRICE_FEED_DATA, { from: alice })
    const statusAfter = await priceFeed.status()
    assert.equal(statusAfter, '1') // status 1: using Chainlink, Pyth untrusted

    let price = await priceFeed.lastGoodPrice()
    // Check Sable PriceFeed gives Chainlink price
    assert.equal(price.toString(), dec(123, 18))
  })

  it("C1 pythWorking: Pyth broken by fetch > 120s passed price, Chainlink working, switch to usingChainlinkPythUntrusted", async () => {
    await setAddresses()
    const statusBefore = await priceFeed.status()
    assert.equal(statusBefore, '0') // status 0: Pyth working

    let mockPrice = dec(999, 8)
    await mockPyth.mockPrices(PRICE_ID, mockPrice, 0, -8, mockPrice, 0, 0)
    await priceFeed.setLastGoodPrice(dec(999, 18))

    await mockChainlink.setDecimals(6)
    await mockChainlink.setPrevPrice(dec(123, 6))
    await mockChainlink.setPrice(dec(123, 6))

    await mockPyth.mockPrices(PRICE_ID, BigInt(mockPrice), 0, -8, BigInt(mockPrice), 0, BigInt(0))

    const priceFetchTx = await priceFeed.fetchPrice(DEFAULT_PRICE_FEED_DATA, { from: alice })
    const statusAfter = await priceFeed.status()
    assert.equal(statusAfter, '1') // status 1: using Chainlink, Pyth untrusted
  })

  it("C1 pythWorking: Pyth broken by fetch > 5s future price, Chainlink working, switch to usingChainlinkPythUntrusted", async () => {
    await setAddresses()
    const statusBefore = await priceFeed.status()
    assert.equal(statusBefore, '0') // status 0: Pyth working

    let now = await th.getLatestBlockTimestamp(web3)
    let mockPrice = dec(999, 8)
    await mockPyth.mockPrices(PRICE_ID, mockPrice, 0, -8, mockPrice, 0, BigInt(now))
    await priceFeed.setLastGoodPrice(dec(999, 18))

    await mockChainlink.setDecimals(6)
    await mockChainlink.setPrevPrice(dec(123, 6))
    await mockChainlink.setPrice(dec(123, 6))

    now = await th.getLatestBlockTimestamp(web3)
    // pythPublishTime = block.timestamp + 8 seconds
    await mockPyth.mockPrices(PRICE_ID, BigInt(mockPrice), 0, -8, BigInt(mockPrice), 0, toBN(now).add(toBN(8)))

    const priceFetchTx = await priceFeed.fetchPrice(DEFAULT_PRICE_FEED_DATA, { from: alice })
    const statusAfter = await priceFeed.status()
    assert.equal(statusAfter, '1') // status 1: using Chainlink, Pyth untrusted
  })

  it("C1 pythWorking: Pyth broken by fetch > 5s future price, Chainlink working, return Chainlink price", async () => {
    await setAddresses()
    const statusBefore = await priceFeed.status()
    assert.equal(statusBefore, '0') // status 0: Pyth working

    let now = await th.getLatestBlockTimestamp(web3)
    let mockPrice = dec(999, 8)
    await mockPyth.mockPrices(PRICE_ID, mockPrice, 0, -8, mockPrice, 0, BigInt(now))
    await priceFeed.setLastGoodPrice(dec(999, 18))

    await mockChainlink.setDecimals(6)
    await mockChainlink.setPrevPrice(dec(123, 6))
    await mockChainlink.setPrice(dec(123, 6))

    now = await th.getLatestBlockTimestamp(web3)
    // pythPublishTime = block.timestamp + 8 seconds
    await mockPyth.mockPrices(PRICE_ID, BigInt(mockPrice), 0, -8, BigInt(mockPrice), 0, toBN(now).add(toBN(8)))

    const priceFetchTx = await priceFeed.fetchPrice(DEFAULT_PRICE_FEED_DATA, { from: alice })
    let price = await priceFeed.lastGoodPrice()
    assert.equal(price.toString(), dec(123, 18))
  })

  it("C1 pythWorking: Pyth broken by zero timestamp, Chainlink working, return Chainlink price", async () => {
    await setAddresses()
    const statusBefore = await priceFeed.status()
    assert.equal(statusBefore, '0') // status 0: Pyth working

    const now = await th.getLatestBlockTimestamp(web3)
    let mockPrice = dec(999, 8)
    await mockPyth.mockPrices(PRICE_ID, BigInt(mockPrice), 0, -8, BigInt(mockPrice), 0, BigInt(now))
    await priceFeed.setLastGoodPrice(dec(999, 18))

    await mockChainlink.setDecimals(6)
    await mockChainlink.setPrevPrice(dec(123, 6))
    await mockChainlink.setPrice(dec(123, 6))

    await mockPyth.mockPrices(PRICE_ID, BigInt(mockPrice), 0, -8, BigInt(mockPrice), 0, BigInt(0))

    const priceFetchTx = await priceFeed.fetchPrice(DEFAULT_PRICE_FEED_DATA, { from: alice })

    let price = await priceFeed.lastGoodPrice()
    assert.equal(price.toString(), dec(123, 18))
  })

  it("C1 Pyth working: Pyth broken by zero timestamp, Chainlink working, return Chainlink price - fetchPriceResult should return correct results", async () => {

    await setAddresses()
    const statusBefore = await priceFeed.status()
    assert.equal(statusBefore, '0') // status 0: Pyth working

    let now = await th.getLatestBlockTimestamp(web3)
    let mockPrice = dec(999, 8)
    await mockPyth.mockPrices(PRICE_ID, BigInt(mockPrice), 0, -8, BigInt(mockPrice), 0, BigInt(now))
    await priceFeed.setLastGoodPrice(dec(999, 18))

    await mockChainlink.setDecimals(6)
    await mockChainlink.setPrevPrice(dec(123, 6))
    await mockChainlink.setPrice(dec(123, 6))

    await mockPyth.mockPrices(PRICE_ID, BigInt(mockPrice), 0, -8, BigInt(mockPrice), 0, BigInt(0))

    const priceFetchTx = await priceFeed.fetchPrice(DEFAULT_PRICE_FEED_DATA, { from: alice })

    let price = await priceFeed.lastGoodPrice()
    assert.equal(price.toString(), dec(123, 18))

    await priceFeed.logPythFetchPriceResult(DEFAULT_PRICE_FEED_DATA)
    let fetchPriceResult = await priceFeed.getInternalFetchPriceResult();
    const oracleKey = web3.utils.hexToAscii(fetchPriceResult.oracleKey);
    assert.isTrue(oracleKey.toString().includes("LINK"));

    // Using LINK -> deviationPyth = 0
    assert.equal(Number(fetchPriceResult.deviationPyth), Number(0))

    let current = await th.getLatestBlockTimestamp(web3)
    let timeDiff = Number(current) - Number(now)

    let oracleRate = await oracleCalc.getOracleRate(fetchPriceResult.oracleKey, fetchPriceResult.deviationPyth, fetchPriceResult.publishTimePyth);
    // Using LINK -> oracleRate = 0.25%
    assert.equal(oracleRate.toString(), dec(25, 14))
    
  })

  it("C1 pythWorking: Pyth broken by future timestamp, Chainlink working, switch to usingChainlinkPythUntrusted", async () => {
    await setAddresses()
    const statusBefore = await priceFeed.status()
    assert.equal(statusBefore, '0') // status 0: Pyth working

    const now = await th.getLatestBlockTimestamp(web3)
    let mockPrice = dec(999, 8)
    await mockPyth.mockPrices(PRICE_ID, BigInt(mockPrice), 0, -8, BigInt(mockPrice), 0, BigInt(now))
    await priceFeed.setLastGoodPrice(dec(999, 18))

    const future = toBN(now).add(toBN('1000'))

    await mockChainlink.setDecimals(6)
    await mockChainlink.setPrevPrice(dec(123, 6))
    await mockChainlink.setPrice(dec(123, 6))

    await mockPyth.mockPrices(PRICE_ID, BigInt(mockPrice), 0, -8, BigInt(mockPrice), 0, BigInt(future))

    const priceFetchTx = await priceFeed.fetchPrice(DEFAULT_PRICE_FEED_DATA, { from: alice })
    const statusAfter = await priceFeed.status()
    assert.equal(statusAfter, '1') // status 1: using Chainlink, Pyth untrusted
  })

  it("C1 pythWorking: Pyth broken by future timestamp, Chainlink working, return Chainlink price", async () => {
    await setAddresses()
    const statusBefore = await priceFeed.status()
    assert.equal(statusBefore, '0') // status 0: Pyth working

    const now = await th.getLatestBlockTimestamp(web3)
    let mockPrice = dec(999, 8)
    await mockPyth.mockPrices(PRICE_ID, BigInt(mockPrice), 0, -8, BigInt(mockPrice), 0, BigInt(now))
    await priceFeed.setLastGoodPrice(dec(999, 18))

    const future = toBN(now).add(toBN('1000'))

    await mockChainlink.setDecimals(6)
    await mockChainlink.setPrevPrice(dec(123, 6))
    await mockChainlink.setPrice(dec(123, 6))

    await mockPyth.mockPrices(PRICE_ID, BigInt(mockPrice), 0, -8, BigInt(mockPrice), 0, BigInt(future))

    const priceFetchTx = await priceFeed.fetchPrice(DEFAULT_PRICE_FEED_DATA, { from: alice })

    let price = await priceFeed.lastGoodPrice()
    assert.equal(price, dec(123, 18))
  })

  it("C1 pythWorking: Pyth broken by negative price, Chainlink working, switch to usingChainlinkPythUntrusted", async () => {
    await setAddresses()
    const statusBefore = await priceFeed.status()
    assert.equal(statusBefore, '0') // status 0: Pyth working

    const now = await th.getLatestBlockTimestamp(web3)
    let mockPrice = dec(999, 8)
    await mockPyth.mockPrices(PRICE_ID, BigInt(mockPrice), 0, -8, BigInt(mockPrice), 0, BigInt(now))
    await priceFeed.setLastGoodPrice(dec(999, 18))

    await mockChainlink.setDecimals(6)
    await mockChainlink.setPrevPrice(dec(123, 6))
    await mockChainlink.setPrice(dec(123, 6))

    mockPrice = "-5000"
    await mockPyth.mockPrices(PRICE_ID, BigInt(mockPrice), 0, -8, BigInt(mockPrice), 0, BigInt(now))

    const priceFetchTx = await priceFeed.fetchPrice(DEFAULT_PRICE_FEED_DATA, { from: alice })
    const statusAfter = await priceFeed.status()
    assert.equal(statusAfter, '1') // status 1: using Chainlink, Pyth untrusted
  })

  it("C1 pythWorking: Pyth broken by negative price, Chainlink working, return Chainlink price", async () => {
    await setAddresses()
    const statusBefore = await priceFeed.status()
    assert.equal(statusBefore, '0') // status 0: Pyth working

    const now = await th.getLatestBlockTimestamp(web3)
    let mockPrice = dec(999, 8)
    await mockPyth.mockPrices(PRICE_ID, BigInt(mockPrice), 0, -8, BigInt(mockPrice), 0, BigInt(now))
    await priceFeed.setLastGoodPrice(dec(999, 18))

    await mockChainlink.setDecimals(6)
    await mockChainlink.setPrevPrice(dec(123, 6))
    await mockChainlink.setPrice(dec(123, 6))

    mockPrice = "-5000"
    await mockPyth.mockPrices(PRICE_ID, BigInt(mockPrice), 0, -8, BigInt(mockPrice), 0, BigInt(now))

    const priceFetchTx = await priceFeed.fetchPrice(DEFAULT_PRICE_FEED_DATA, { from: alice })

    let price = await priceFeed.lastGoodPrice()
    assert.equal(price, dec(123, 18))
  })

  // --- Pyth timeout --- 

  it("C1 chainlinkWorking: Pyth frozen, Chainlink working: switch to usingChainlinkPythFrozen", async () => {
    await setAddresses()
    const statusBefore = await priceFeed.status()
    assert.equal(statusBefore, '0') // status 0: Pyth working

    let now = await th.getLatestBlockTimestamp(web3)
    let mockPrice = dec(999, 8)
    await mockPyth.mockPrices(PRICE_ID, BigInt(mockPrice), 0, -8, BigInt(mockPrice), 0, BigInt(now))
    await priceFeed.setLastGoodPrice(dec(999, 18))

    await th.fastForwardTime(PYTH_FROZEN_TIME, web3.currentProvider) // fast forward 30 seconds
    now = await th.getLatestBlockTimestamp(web3)

    // Chainlink price is recent
    await mockChainlink.setUpdateTime(now)
    await mockChainlink.setDecimals(6)
    await mockChainlink.setPrevPrice(dec(123, 6))
    await mockChainlink.setPrice(dec(123, 6))

    const priceFetchTx = await priceFeed.fetchPrice(DEFAULT_PRICE_FEED_DATA, { from: alice })
    const statusAfter = await priceFeed.status()
    assert.equal(statusAfter.toString(), '3') // status 3: using Chainlink, Pyth frozen 
  })

  it("C1 pythWorking: Pyth frozen, Chainlink working: return Chainlink price", async () => {
    await setAddresses()
    const statusBefore = await priceFeed.status()
    assert.equal(statusBefore, '0') // status 0: Pyth working

    let now = await th.getLatestBlockTimestamp(web3)
    let mockPrice = dec(999, 8)
    await mockPyth.mockPrices(PRICE_ID, BigInt(mockPrice), 0, -8, BigInt(mockPrice), 0, BigInt(now))
    await priceFeed.setLastGoodPrice(dec(999, 18))

    await th.fastForwardTime(PYTH_FROZEN_TIME, web3.currentProvider) // fast forward 30 seconds
    now = await th.getLatestBlockTimestamp(web3)

    /// Chainlink price is recent
    await mockChainlink.setUpdateTime(now)
    await mockChainlink.setDecimals(6)
    await mockChainlink.setPrevPrice(dec(123, 6))
    await mockChainlink.setPrice(dec(123, 6))

    const priceFetchTx = await priceFeed.fetchPrice(DEFAULT_PRICE_FEED_DATA, { from: alice })

    let price = await priceFeed.lastGoodPrice()
    assert.equal(price, dec(123, 18))
  })

  it("C1 pythWorking: Pyth frozen, Chainlink frozen: switch to usingChainlinkPythFrozen", async () => {
    await setAddresses()
    const statusBefore = await priceFeed.status()
    assert.equal(statusBefore, '0') // status 0: Pyth working

    let now = await th.getLatestBlockTimestamp(web3)
    let mockPrice = dec(999, 8)
    await mockPyth.mockPrices(PRICE_ID, BigInt(mockPrice), 0, -8, BigInt(mockPrice), 0, BigInt(now))
    await priceFeed.setLastGoodPrice(dec(999, 18))

    await mockChainlink.setDecimals(6)
    await mockChainlink.setPrevPrice(dec(123, 6))
    await mockChainlink.setPrice(dec(123, 6))

    await th.fastForwardTime(CHAINLINK_FROZEN_TIME, web3.currentProvider) // fast forward 4 hours

    now = await th.getLatestBlockTimestamp(web3)
    await mockPyth.mockPrices(PRICE_ID, BigInt(mockPrice), 0, -8, BigInt(mockPrice), 0, BigInt(now))
    await th.fastForwardTime(PYTH_FROZEN_TIME, web3.currentProvider) // fast forward 30 seconds
    // check Pyth price timestamp is out of date by > 30 seconds
    const BNBFeed = await priceFeed.BNBFeed();
    const pythUpdateTime = (await mockPyth.queryPriceFeed(BNBFeed))[0][3]
    assert.isTrue(toBN(pythUpdateTime).lt(toBN(now).sub(toBN(PYTH_FROZEN_TIME))))

    // check Chainlink price timestamp is out of date by > 4 hours
    now = await th.getLatestBlockTimestamp(web3)
    const chainlinkUpdateTime = (await mockChainlink.latestRoundData())[3]
    assert.isTrue(chainlinkUpdateTime.lt(toBN(now).sub(toBN(CHAINLINK_FROZEN_TIME))))

    const priceFetchTx = await priceFeed.fetchPrice(DEFAULT_PRICE_FEED_DATA, { from: alice })
    const statusAfter = await priceFeed.status()
    assert.equal(statusAfter, '3') // status 3: using Chainlink, Pyth frozen
  })

  it("C1 pythWorking: Pyth frozen, Chainlink frozen: return last good price", async () => {
    await setAddresses()
    const statusBefore = await priceFeed.status()
    assert.equal(statusBefore, '0') // status 0: Pyth working

    let now = await th.getLatestBlockTimestamp(web3)
    let mockPrice = dec(999, 8)
    await mockPyth.mockPrices(PRICE_ID, BigInt(mockPrice), 0, -8, BigInt(mockPrice), 0, BigInt(now))
    await priceFeed.setLastGoodPrice(dec(999, 18))

    await mockChainlink.setDecimals(6)
    await mockChainlink.setPrevPrice(dec(123, 6))
    await mockChainlink.setPrice(dec(123, 6))

    await th.fastForwardTime(CHAINLINK_FROZEN_TIME, web3.currentProvider) // Fast forward 4 hours

    // check Chainlink price timestamp is out of date by > 4 hours
    now = await th.getLatestBlockTimestamp(web3)
    const chainlinkUpdateTime = (await mockChainlink.latestRoundData())[3]
    assert.isTrue(chainlinkUpdateTime.lt(toBN(now).sub(toBN(14400))))

    const priceFetchTx = await priceFeed.fetchPrice(DEFAULT_PRICE_FEED_DATA, { from: alice })
    let price = await priceFeed.lastGoodPrice()
    // Expect lastGoodPrice has not updated
    assert.equal(price, dec(999, 18))
  })

  it("C1 pythWorking: Pyth times out, Chainlink broken by 0 price: switch to usingPythChainlinkUntrusted", async () => {
    await setAddresses()
    const statusBefore = await priceFeed.status()
    assert.equal(statusBefore, '0') // status 0: Pyth working

    let now = await th.getLatestBlockTimestamp(web3)
    let mockPrice = dec(999, 8)
    await mockPyth.mockPrices(PRICE_ID, BigInt(mockPrice), 0, -8, BigInt(mockPrice), 0, BigInt(now))
    await priceFeed.setLastGoodPrice(dec(999, 18))

    await th.fastForwardTime(PYTH_FROZEN_TIME, web3.currentProvider) // Fast forward 30 seconds

    // Chainlink breaks by 0 price
    await mockChainlink.setDecimals(6)
    await mockChainlink.setPrice(0)

    const priceFetchTx = await priceFeed.fetchPrice(DEFAULT_PRICE_FEED_DATA, { from: alice })
    const statusAfter = await priceFeed.status()
    assert.equal(statusAfter, '4') // status 4: using Pyth, Chainlink untrusted
  })

  it("C1 pythWorking: Pyth times out, Chainlink broken by 0 price: return last good price", async () => {
    await setAddresses()
    const statusBefore = await priceFeed.status()
    assert.equal(statusBefore, '0') // status 0: Pyth working

    let now = await th.getLatestBlockTimestamp(web3)
    let mockPrice = dec(999, 8)
    await mockPyth.mockPrices(PRICE_ID, BigInt(mockPrice), 0, -8, BigInt(mockPrice), 0, BigInt(now))
    await priceFeed.setLastGoodPrice(dec(999, 18))

    await th.fastForwardTime(PYTH_FROZEN_TIME, web3.currentProvider) // Fast forward 30 seconds

    // Chainlink breaks by 0 price
    await mockChainlink.setDecimals(6)
    await mockChainlink.setPrice(0)

    const priceFetchTx = await priceFeed.fetchPrice(DEFAULT_PRICE_FEED_DATA, { from: alice })
    let price = await priceFeed.lastGoodPrice()

    // Expect lastGoodPrice has not updated
    assert.equal(price, dec(999, 18))
  })

  it("C1 pythWorking: Pyth is out of date by <30 seconds: remain pythWorking", async () => {
    await setAddresses()
    const statusBefore = await priceFeed.status()
    assert.equal(statusBefore, '0') // status 0: Pyth working

    let now = await th.getLatestBlockTimestamp(web3)
    let mockPrice = dec(1234, 8)
    await mockPyth.mockPrices(PRICE_ID, BigInt(mockPrice), 0, -8, BigInt(mockPrice), 0, BigInt(now))
    await th.fastForwardTime(25, web3.currentProvider) // fast forward 25 seconds 

    const priceFetchTx = await priceFeed.fetchPrice(DEFAULT_PRICE_FEED_DATA, { from: alice })
    const statusAfter = await priceFeed.status()
    assert.equal(statusAfter, '0') // status 0: Pyth working
  })

  it("C1 pythWorking: Pyth is out of date by <30 seconds: return Pyth price", async () => {
    await setAddresses()
    const statusBefore = await priceFeed.status()
    assert.equal(statusBefore, '0') // status 0: Pyth working

    let now = await th.getLatestBlockTimestamp(web3)
    let mockPrice = dec(1234, 8)
    await mockPyth.mockPrices(PRICE_ID, BigInt(mockPrice), 0, -8, BigInt(mockPrice), 0, BigInt(now))
    await th.fastForwardTime(25, web3.currentProvider) // fast forward 25 seconds 

    const priceFetchTx = await priceFeed.fetchPrice(DEFAULT_PRICE_FEED_DATA, { from: alice })
    const price = await priceFeed.lastGoodPrice()
    assert.equal(price, dec(1234, 18))
  })

  // --- Pyth price deviation ---

  it("C1 pythWorking: Pyth broken by deviationPyth > 0.25%, switch to usingChainlinkPythUntrusted", async () => {
    await setAddresses()
    priceFeed.setLastGoodPrice(dec(2, 18)) 

    const statusBefore = await priceFeed.status()
    assert.equal(statusBefore, '0') // status 0: Pyth working

    await mockChainlink.setPrevPrice(dec(202, 4))
    await mockChainlink.setPrice(dec(203, 4))

    // Make deviation > 0.25%
    const now = await th.getLatestBlockTimestamp(web3)
    let mockPrice = dec(200, 8) // mockPrice = 200 USD
    // mock pyth price with deviationPyth > 0.25%
    const conf = dec(52, 8); // 26%
    await mockPyth.mockPrices(PRICE_ID, BigInt(mockPrice), conf, -8, BigInt(mockPrice), conf, BigInt(now))

    const priceFetchTx = await priceFeed.fetchPrice(DEFAULT_PRICE_FEED_DATA, { from: alice })
    const statusAfter = await priceFeed.status()
    assert.equal(statusAfter, '1') // status 1: using Chainlink, Pyth untrusted
  })

  it("C1 pythWorking: Pyth broken by deviationPyth > 0.25%, return the Chainlink price", async () => {
    await setAddresses()
    priceFeed.setLastGoodPrice(dec(2, 18)) 

    const statusBefore = await priceFeed.status()
    assert.equal(statusBefore, '0') // status 0: Pyth working

    await mockChainlink.setDecimals(4)
    await mockChainlink.setPrevPrice(dec(202, 4))
    await mockChainlink.setPrice(dec(203, 4))

    // Make deviation > 0.25%
    const now = await th.getLatestBlockTimestamp(web3)
    let mockPrice = dec(200, 8) // mockPrice = 200 USD
    // mock pyth price with deviationPyth > 0.25%
    const conf = dec(52, 8); // 26%
    await mockPyth.mockPrices(PRICE_ID, BigInt(mockPrice), conf, -8, BigInt(mockPrice), conf, BigInt(now))

    const priceFetchTx = await priceFeed.fetchPrice(DEFAULT_PRICE_FEED_DATA, { from: alice })

    let price = await priceFeed.lastGoodPrice()
    assert.equal(price.toString(), dec(203, 18))
  })

  it("C1 pythWorking: deviationPyth = 0.25%, remain pythWorking", async () => {
    await setAddresses()
    priceFeed.setLastGoodPrice(dec(2, 18)) 

    const statusBefore = await priceFeed.status()
    assert.equal(statusBefore, '0') // status 0: Pyth working

    await mockChainlink.setDecimals(4)
    await mockChainlink.setPrevPrice(dec(202, 4))
    await mockChainlink.setPrice(dec(203, 4))

    // Make deviation = 0.25%
    const now = await th.getLatestBlockTimestamp(web3)
    let mockPrice = dec(200, 8) // mockPrice = 200 USD
    // mock pyth price with deviationPyth = 0.25%
    const conf = dec(50, 8); // 25%
    await mockPyth.mockPrices(PRICE_ID, BigInt(mockPrice), conf, -8, BigInt(mockPrice), conf, BigInt(now))

    const priceFetchTx = await priceFeed.fetchPrice(DEFAULT_PRICE_FEED_DATA, { from: alice })
    const statusAfter = await priceFeed.status()
    assert.equal(statusAfter, '0') // status 0: Pyth working
  })

  it("C1 pythWorking: deviationPyth = 0.25%, return the Pyth price", async () => {
    await setAddresses()
    priceFeed.setLastGoodPrice(dec(2, 18)) 

    const statusBefore = await priceFeed.status()
    assert.equal(statusBefore, '0') // status 0: Pyth working

    await mockChainlink.setDecimals(4)
    await mockChainlink.setPrevPrice(dec(202, 4))
    await mockChainlink.setPrice(dec(203, 4))

    // Make deviation = 0.25%
    const now = await th.getLatestBlockTimestamp(web3)
    let mockPrice = dec(200, 8) // mockPrice = 200 USD
    // mock pyth price with deviationPyth = 0.25%
    const conf = dec(50, 8); // 25%
    await mockPyth.mockPrices(PRICE_ID, BigInt(mockPrice), conf, -8, BigInt(mockPrice), conf, BigInt(now))

    const priceFetchTx = await priceFeed.fetchPrice(DEFAULT_PRICE_FEED_DATA, { from: alice })

    let price = await priceFeed.lastGoodPrice()
    assert.equal(price, dec(200, 18))
  })

  it("C1 pythWorking: deviationPyth < 0.25%, remain pythWorking", async () => {
    await setAddresses()
    priceFeed.setLastGoodPrice(dec(2, 18)) 

    const statusBefore = await priceFeed.status()
    assert.equal(statusBefore, '0') // status 0: Pyth working

    await mockChainlink.setDecimals(4)
    await mockChainlink.setPrevPrice(dec(202, 4))
    await mockChainlink.setPrice(dec(203, 4))

    // Make deviation < 0.25%
    const now = await th.getLatestBlockTimestamp(web3)
    let mockPrice = dec(200, 8) // mockPrice = 200 USD
    // mock pyth price with deviationPyth < 0.25%
    const conf = dec(48, 8); // 24%
    await mockPyth.mockPrices(PRICE_ID, BigInt(mockPrice), conf, -8, BigInt(mockPrice), conf, BigInt(now))

    const priceFetchTx = await priceFeed.fetchPrice(DEFAULT_PRICE_FEED_DATA, { from: alice })
    const statusAfter = await priceFeed.status()
    assert.equal(statusAfter, '0') // status 0: Pyth working 
  })

  it("C1 pythWorking: deviationPyth < 0.25%, return Pyth price", async () => {
    await setAddresses()
    priceFeed.setLastGoodPrice(dec(2, 18)) 

    const statusBefore = await priceFeed.status()
    assert.equal(statusBefore, '0') // status 0: Pyth working

    await mockChainlink.setDecimals(4)
    await mockChainlink.setPrevPrice(dec(202, 4))
    await mockChainlink.setPrice(dec(203, 4))

    // Make deviation < 0.25%
    const now = await th.getLatestBlockTimestamp(web3)
    let mockPrice = dec(200, 8) // mockPrice = 200 USD
    // mock pyth price with deviationPyth < 0.25%
    const conf = dec(48, 8); // 24%
    await mockPyth.mockPrices(PRICE_ID, BigInt(mockPrice), conf, -8, BigInt(mockPrice), conf, BigInt(now))

    const priceFetchTx = await priceFeed.fetchPrice(DEFAULT_PRICE_FEED_DATA, { from: alice })

    let price = await priceFeed.lastGoodPrice()
    assert.equal(price, dec(200, 18))
  })

  // --- Pyth fails and Chainlink is broken ---

  it("C1 pythWorking: Pyth broken by deviationPyth > 0.25% and Chainlink is broken by 0 price: switch to bothOracleSuspect", async () => {
    await setAddresses()
    const statusBefore = await priceFeed.status()
    assert.equal(statusBefore, '0') // status 0: Pyth working

    const now = await th.getLatestBlockTimestamp(web3)
    let mockPrice = dec(200, 8) // mockPrice = 200 USD
    // mock pyth price with deviationPyth > 0.25%
    const conf = dec(52, 8); // 26%
    await mockPyth.mockPrices(PRICE_ID, BigInt(mockPrice), conf, -8, BigInt(mockPrice), conf, BigInt(now))

    // Make mock Chainlink return 0 price
    await mockChainlink.setPrice(0)

    const priceFetchTx = await priceFeed.fetchPrice(DEFAULT_PRICE_FEED_DATA, { from: alice })

    const statusAfter = await priceFeed.status()
    assert.equal(statusAfter, '2') // status 2: both oracles untrusted
  })

  it("C1 pythWorking: Pyth broken by deviationPyth > 0.25% and Chainlink is broken by 0 price: return last good price", async () => {
    await setAddresses()
    priceFeed.setLastGoodPrice(dec(1200, 18)) // establish a "last good price" from the previous price fetch

    const statusBefore = await priceFeed.status()
    assert.equal(statusBefore, '0') // status 0: Pyth working

    const now = await th.getLatestBlockTimestamp(web3)
    let mockPrice = dec(200, 8) // mockPrice = 200 USD
    // mock pyth price with deviationPyth > 0.25%
    const conf = dec(52, 8); // 26%
    await mockPyth.mockPrices(PRICE_ID, BigInt(mockPrice), conf, -8, BigInt(mockPrice), conf, BigInt(now))

    // Make mock Chainlink return 0 price
    await mockChainlink.setPrice(0)

    const priceFetchTx = await priceFeed.fetchPrice(DEFAULT_PRICE_FEED_DATA, { from: alice })
    let price = await priceFeed.lastGoodPrice()

    // Check that the returned price is in fact the previous price
    assert.equal(price, dec(1200, 18))
  })

  it("C1 pythWorking: Pyth broken by deviationPyth > 0.25% and Chainlink is broken by 0 timestamp: switch to bothOracleSuspect", async () => {
    await setAddresses()
    const statusBefore = await priceFeed.status()
    assert.equal(statusBefore, '0') // status 0: Pyth working

    // Make mock Pyth price deviate too much
    const now = await th.getLatestBlockTimestamp(web3)
    let mockPrice = dec(200, 8) // mockPrice = 200 USD
    const conf = dec(52, 8); // 26%
    await mockPyth.mockPrices(PRICE_ID, BigInt(mockPrice), conf, -8, BigInt(mockPrice), conf, BigInt(now))

    // Make mock Chainlink return 0 timestamp
    await mockChainlink.setUpdateTime(0)
    const priceFetchTx = await priceFeed.fetchPrice(DEFAULT_PRICE_FEED_DATA, { from: alice })

    const statusAfter = await priceFeed.status()
    assert.equal(statusAfter, '2') // status 2: both oracles untrusted
  })

  it("C1 pythWorking: Pyth broken by deviationPyth > 0.25% and Chainlink is broken by 0 timestamp: return last good price", async () => {
    await setAddresses()
    priceFeed.setLastGoodPrice(dec(1200, 18)) // establish a "last good price" from the previous price fetch

    const statusBefore = await priceFeed.status()
    assert.equal(statusBefore, '0') // status 0: Pyth working

    // Make mock Pyth price deviate too much
    const now = await th.getLatestBlockTimestamp(web3)
    let mockPrice = dec(200, 8) // mockPrice = 200 USD
    const conf = dec(52, 8); // 26%
    await mockPyth.mockPrices(PRICE_ID, BigInt(mockPrice), conf, -8, BigInt(mockPrice), conf, BigInt(now))

    // Make mock Chainlink return 0 timestamp
    await mockChainlink.setUpdateTime(0)
    const priceFetchTx = await priceFeed.fetchPrice(DEFAULT_PRICE_FEED_DATA, { from: alice })

    let price = await priceFeed.lastGoodPrice()

    // Check that the returned price is in fact the previous price
    assert.equal(price, dec(1200, 18))
  })

  it("C1 pythWorking: Pyth broken by deviationPyth > 0.25% and Chainlink is broken by future timestamp: Pricefeed switches to bothOracleSuspect", async () => {
    await setAddresses()
    const statusBefore = await priceFeed.status()
    assert.equal(statusBefore, '0') // status 0: Pyth working

    // Make mock Pyth price deviate too much
    let now = await th.getLatestBlockTimestamp(web3)
    let mockPrice = dec(200, 8) // mockPrice = 200 USD
    const conf = dec(52, 8); // 26%
    await mockPyth.mockPrices(PRICE_ID, BigInt(mockPrice), conf, -8, BigInt(mockPrice), conf, BigInt(now))

    // Make mock Chainlink return a future timestamp
    now = await th.getLatestBlockTimestamp(web3)
    const future = toBN(now).add(toBN("10000"))
    await mockChainlink.setUpdateTime(future)

    const priceFetchTx = await priceFeed.fetchPrice(DEFAULT_PRICE_FEED_DATA, { from: alice })

    const statusAfter = await priceFeed.status()
    assert.equal(statusAfter, '2') // status 2: both oracles untrusted
  })

  it("C1 pythWorking: Pyth broken by deviationPyth > 0.25% and Chainlink is broken by future timestamp: return last good price", async () => {
    await setAddresses()
    priceFeed.setLastGoodPrice(dec(1200, 18)) // establish a "last good price" from the previous price fetch

    const statusBefore = await priceFeed.status()
    assert.equal(statusBefore, '0') // status 0: Pyth working

    // Make mock Pyth price deviate too much
    let now = await th.getLatestBlockTimestamp(web3)
    let mockPrice = dec(200, 8) // mockPrice = 200 USD
    const conf = dec(52, 8); // 26%
    await mockPyth.mockPrices(PRICE_ID, BigInt(mockPrice), conf, -8, BigInt(mockPrice), conf, BigInt(now))

    // Make mock Chainlink return a future timestamp
    now = await th.getLatestBlockTimestamp(web3)
    const future = toBN(now).add(toBN("10000"))
    await mockChainlink.setUpdateTime(future)

    const priceFetchTx = await priceFeed.fetchPrice(DEFAULT_PRICE_FEED_DATA, { from: alice })
    let price = await priceFeed.lastGoodPrice()

    // Check that the returned price is in fact the previous price
    assert.equal(price, dec(1200, 18))
  })

  // -- Pyth is working 
  it("C1 pythWorking: Pyth is working and Chainlink is working - remain on pythWorking", async () => { 
    await setAddresses()
    priceFeed.setLastGoodPrice(dec(1200, 18)) 

    const statusBefore = await priceFeed.status()
    assert.equal(statusBefore, '0') // status 0: Pyth working

    const now = await th.getLatestBlockTimestamp(web3)
    let mockPrice = dec(101, 8)
    await mockPyth.mockPrices(PRICE_ID, BigInt(mockPrice), 0, -8, BigInt(mockPrice), 0, BigInt(now))

    await mockChainlink.setPrevPrice(dec(103, 8))
    await mockChainlink.setPrice(dec(102, 8)) 

    const priceFetchTx = await priceFeed.fetchPrice(DEFAULT_PRICE_FEED_DATA, { from: alice })

    const statusAfter = await priceFeed.status()
    assert.equal(statusAfter, '0') // status 0: Pyth working
  })

  it("C1 pythWorking: Pyth is working and Chainlink is working - return Pyth price", async () => { 
    await setAddresses()
    priceFeed.setLastGoodPrice(dec(1200, 18)) 

    const statusBefore = await priceFeed.status()
    assert.equal(statusBefore, '0') // status 0: Pyth working

    const now = await th.getLatestBlockTimestamp(web3)
    let mockPrice = dec(102, 8)
    await mockPyth.mockPrices(PRICE_ID, BigInt(mockPrice), 0, -8, BigInt(mockPrice), 0, BigInt(now))

    await mockChainlink.setPrevPrice(dec(105, 8))
    await mockChainlink.setPrice(dec(104, 8)) 

    const priceFetchTx = await priceFeed.fetchPrice(DEFAULT_PRICE_FEED_DATA, { from: alice })
    let price = await priceFeed.lastGoodPrice()

    // Check that the returned price is current Pyth price
    assert.equal(price, dec(102, 18))
  })

  it("C1 pythWorking: Pyth is working and Chainlink freezes - remain on pythWorking", async () => { 
    await setAddresses()
    priceFeed.setLastGoodPrice(dec(1200, 18)) 

    const statusBefore = await priceFeed.status()
    assert.equal(statusBefore, '0') // status 0: Pyth working

    await mockChainlink.setPrevPrice(dec(101, 8))
    await mockChainlink.setPrice(dec(102, 8)) 

    let now = await th.getLatestBlockTimestamp(web3)
    let mockPrice = dec(101, 8)
    await mockPyth.mockPrices(PRICE_ID, BigInt(mockPrice), 0, -8, BigInt(mockPrice), 0, BigInt(now))

    await mockChainlink.setPrevPrice(dec(103, 8))
    await mockChainlink.setPrice(dec(103, 8)) 

    // 4 hours pass with no Chainlink updates
    await th.fastForwardTime(CHAINLINK_FROZEN_TIME, web3.currentProvider)

    // check Chainlink price timestamp is out of date by > 4 hours
    now = await th.getLatestBlockTimestamp(web3)
    const chainlinkUpdateTime = (await mockChainlink.latestRoundData())[3]
    assert.isTrue(chainlinkUpdateTime.lt(toBN(now).sub(toBN(14400))))

    // Pyth price is current
    await mockPyth.mockPrices(PRICE_ID, BigInt(mockPrice), 0, -8, BigInt(mockPrice), 0, BigInt(now))

    const priceFetchTx = await priceFeed.fetchPrice(DEFAULT_PRICE_FEED_DATA, { from: alice })

    const statusAfter = await priceFeed.status()
    assert.equal(statusAfter, '0') // status 0: Pyth working
  })

  it("C1 pythWorking: Pyth is working and Chainlink freezes - return Pyth price", async () => { 
    await setAddresses()
    priceFeed.setLastGoodPrice(dec(1200, 18)) 

    const statusBefore = await priceFeed.status()
    assert.equal(statusBefore, '0') // status 0: Pyth working

    let now = await th.getLatestBlockTimestamp(web3)
    let mockPrice = dec(102, 8)
    await mockPyth.mockPrices(PRICE_ID, BigInt(mockPrice), 0, -8, BigInt(mockPrice), 0, BigInt(now))

    await mockChainlink.setPrevPrice(dec(103, 8))
    await mockChainlink.setPrice(dec(103, 8)) 

    // 4 hours pass with no Chainlink updates
    await th.fastForwardTime(14400, web3.currentProvider)

    // check Chainlink price timestamp is out of date by > 4 hours
    now = await th.getLatestBlockTimestamp(web3)
    const chainlinkUpdateTime = (await mockChainlink.latestRoundData())[3]
    assert.isTrue(chainlinkUpdateTime.lt(toBN(now).sub(toBN(14400))))
  
    // Pyth price is current
    await mockPyth.mockPrices(PRICE_ID, BigInt(mockPrice), 0, -8, BigInt(mockPrice), 0, BigInt(now))
    
    const priceFetchTx = await priceFeed.fetchPrice(DEFAULT_PRICE_FEED_DATA, { from: alice })
    let price = await priceFeed.lastGoodPrice()

    // Check that the returned price is current Pyth price
    assert.equal(price, dec(102, 18))
  })

  it("C1 pythWorking: Pyth is working and Chainlink breaks: switch to usingPythChainlinkUntrusted", async () => { 
    await setAddresses()
    priceFeed.setLastGoodPrice(dec(1200, 18)) // establish a "last good price" from the previous price fetch

    const statusBefore = await priceFeed.status()
    assert.equal(statusBefore, '0') // status 0: Pyth working

    let now = await th.getLatestBlockTimestamp(web3)
    let mockPrice = dec(102, 8)
    await mockPyth.mockPrices(PRICE_ID, BigInt(mockPrice), 0, -8, BigInt(mockPrice), 0, BigInt(now))

    await mockChainlink.setPrice(0)

    const priceFetchTx = await priceFeed.fetchPrice(DEFAULT_PRICE_FEED_DATA, { from: alice })
  
    const statusAfter = await priceFeed.status()
    assert.equal(statusAfter, '4') // status 4: Using Pyth, Chainlink untrusted
  })

  it("C1 pythWorking: Pyth is working and Chainlink breaks: return Pyth price", async () => { 
    await setAddresses()
    priceFeed.setLastGoodPrice(dec(1200, 18)) // establish a "last good price" from the previous price fetch

    const statusBefore = await priceFeed.status()
    assert.equal(statusBefore, '0') // status 0: Pyth working

    let now = await th.getLatestBlockTimestamp(web3)
    let mockPrice = dec(102, 8)
    await mockPyth.mockPrices(PRICE_ID, BigInt(mockPrice), 0, -8, BigInt(mockPrice), 0, BigInt(now))

    await mockChainlink.setPrice(0)

    const priceFetchTx = await priceFeed.fetchPrice(DEFAULT_PRICE_FEED_DATA, { from: alice })
    let price = await priceFeed.lastGoodPrice()

    // Check that the returned price is current Pyth price
    assert.equal(price, dec(102, 18))
  })

  // --- Case 2: Using Chainlink ---

  // Using Chainlink, Chainlink breaks
  it("C2 usingChainlinkPythUntrusted: Chainlink breaks by zero price: switch to bothOraclesSuspect", async () => {
    await setAddresses()
    priceFeed.setStatus(1) // status 1: using Chainlink, Pyth untrusted

    let now = await th.getLatestBlockTimestamp(web3)
    let mockPrice = dec(999, 8)
    await mockPyth.mockPrices(PRICE_ID, BigInt(mockPrice), 0, -8, BigInt(mockPrice), 0, BigInt(now))

    await priceFeed.setLastGoodPrice(dec(123, 18))

    now = await th.getLatestBlockTimestamp(web3)
    await mockChainlink.setUpdateTime(now)
    await mockChainlink.setPrice(0)

    await priceFeed.fetchPrice(DEFAULT_PRICE_FEED_DATA, { from: alice })

    const status = await priceFeed.status()
    assert.equal(status, 2)  // status 2: both oracles untrusted
  })

  it("C2 usingChainlinkPythUntrusted: Chainlink breaks by zero price: return last good price", async () => {
    await setAddresses()
    priceFeed.setStatus(1) // status 1: using Chainlink, Pyth untrusted

    let now = await th.getLatestBlockTimestamp(web3)
    let mockPrice = dec(999, 8)
    await mockPyth.mockPrices(PRICE_ID, BigInt(mockPrice), 0, -8, BigInt(mockPrice), 0, BigInt(now))

    await priceFeed.setLastGoodPrice(dec(123, 18))

    now = await th.getLatestBlockTimestamp(web3)
    await mockChainlink.setUpdateTime(now)
    await mockChainlink.setPrice(0)

    await priceFeed.fetchPrice(DEFAULT_PRICE_FEED_DATA, { from: alice })
    const price = await priceFeed.lastGoodPrice()

    assert.equal(price, dec(123, 18))
  })

  it("C2 usingChainlinkPythUntrusted: Chainlink breaks by call reverted: switch to bothOraclesSuspect", async () => {
    await setAddresses()
    priceFeed.setStatus(1) // status 1: using Chainlink, Pyth untrusted

    await priceFeed.setLastGoodPrice(dec(123, 18))

    let now = await th.getLatestBlockTimestamp(web3)
    let mockPrice = dec(999, 8)
    await mockPyth.mockPrices(PRICE_ID, BigInt(mockPrice), 0, -8, BigInt(mockPrice), 0, BigInt(now))

    await mockChainlink.setDecimals(6)
    await mockChainlink.setPrevPrice(dec(999, 6))
    await mockChainlink.setPrice(dec(999, 6))

    await mockChainlink.setLatestRevert()

    await priceFeed.fetchPrice(DEFAULT_PRICE_FEED_DATA, { from: alice })

    const status = await priceFeed.status()
    assert.equal(status, 2)  // status 2: both oracles untrusted
  })

  it("C2 usingChainlinkPythUntrusted: Chainlink breaks by call reverted: return last good price", async () => {
    await setAddresses()
    priceFeed.setStatus(1) // status 1: using Chainlink, Pyth untrusted

    await priceFeed.setLastGoodPrice(dec(123, 18))

    let now = await th.getLatestBlockTimestamp(web3)
    let mockPrice = dec(999, 8)
    await mockPyth.mockPrices(PRICE_ID, BigInt(mockPrice), 0, -8, BigInt(mockPrice), 0, BigInt(now))

    await mockChainlink.setDecimals(6)
    await mockChainlink.setPrevPrice(dec(999, 6))
    await mockChainlink.setPrice(dec(999, 6))

    await mockChainlink.setLatestRevert()
   
    await priceFeed.fetchPrice(DEFAULT_PRICE_FEED_DATA, { from: alice })
    const price = await priceFeed.lastGoodPrice()

    assert.equal(price, dec(123, 18))
  })

  it("C2 usingChainlinkPythUntrusted: Chainlink breaks by zero timestamp: switch to bothOraclesSuspect", async () => {
    await setAddresses()
    priceFeed.setStatus(1) // status 1: using Chainlink, Pyth untrusted

    await priceFeed.setLastGoodPrice(dec(123, 18))

    let now = await th.getLatestBlockTimestamp(web3)
    let mockPrice = dec(999, 8)
    await mockPyth.mockPrices(PRICE_ID, BigInt(mockPrice), 0, -8, BigInt(mockPrice), 0, BigInt(now))

    await mockChainlink.setDecimals(6)
    await mockChainlink.setPrevPrice(dec(999, 6))
    await mockChainlink.setPrice(dec(999, 6))

    await mockChainlink.setUpdateTime(0)

    await priceFeed.fetchPrice(DEFAULT_PRICE_FEED_DATA, { from: alice })

    const status = await priceFeed.status()
    assert.equal(status, 2)  // status 2: both oracles untrusted
  })

  it("C2 usingChainlinkPythUntrusted: Chainlink breaks by zero timestamp: return last good price", async () => {
    await setAddresses()
    priceFeed.setStatus(1) // status 1: using Chainlink, Pyth untrusted

    await priceFeed.setLastGoodPrice(dec(123, 18))

    let now = await th.getLatestBlockTimestamp(web3)
    let mockPrice = dec(999, 8)
    await mockPyth.mockPrices(PRICE_ID, BigInt(mockPrice), 0, -8, BigInt(mockPrice), 0, BigInt(now))

    await mockChainlink.setDecimals(6)
    await mockChainlink.setPrevPrice(dec(999, 6))
    await mockChainlink.setPrice(dec(999, 6))

    await mockChainlink.setUpdateTime(0)
   
    await priceFeed.fetchPrice(DEFAULT_PRICE_FEED_DATA, { from: alice })
    const price = await priceFeed.lastGoodPrice()

    assert.equal(price, dec(123, 18))
  })

  // Using Chainlink, Chainlink freezes
  it("C2 usingChainlinkPythUntrusted: Chainlink freezes - remain usingChainlinkPythUntrusted", async () => {
    await setAddresses()
    priceFeed.setStatus(1) // status 1: using Chainlink, Pyth untrusted

    let now = await th.getLatestBlockTimestamp(web3)
    let mockPrice = dec(999, 8)
    await mockPyth.mockPrices(PRICE_ID, BigInt(mockPrice), 0, -8, BigInt(mockPrice), 0, BigInt(now))

    await priceFeed.setLastGoodPrice(dec(246, 18))

    await mockChainlink.setDecimals(6)
    await mockChainlink.setPrevPrice(dec(123, 6))
    await mockChainlink.setPrice(dec(123, 6))

    await th.fastForwardTime(CHAINLINK_FROZEN_TIME, web3.currentProvider) // Fast forward 4 hours

    // check Chainlink price timestamp is out of date by > 4 hours
    now = await th.getLatestBlockTimestamp(web3)
    const chainlinkUpdateTime = (await mockChainlink.latestRoundData())[3]
    assert.isTrue(chainlinkUpdateTime.lt(toBN(now).sub(toBN(14400))))

    // pyth price is current
    await mockPyth.mockPrices(PRICE_ID, BigInt(mockPrice), 0, -8, BigInt(mockPrice), 0, BigInt(now))

    await priceFeed.fetchPrice(DEFAULT_PRICE_FEED_DATA, { from: alice })

    const status = await priceFeed.status()
    assert.equal(status, 1)  // status 1: using Chainlink, Pyth untrusted
  })

  it("C2 usingChainlinkPythUntrusted: Chainlink freezes - return last good price", async () => {
    await setAddresses()
    priceFeed.setStatus(1) // status 1: using Chainlink, Pyth untrusted

    let now = await th.getLatestBlockTimestamp(web3)
    let mockPrice = dec(999, 8)
    await mockPyth.mockPrices(PRICE_ID, BigInt(mockPrice), 0, -8, BigInt(mockPrice), 0, BigInt(now))

    await priceFeed.setLastGoodPrice(dec(246, 18))

    await mockChainlink.setDecimals(6)
    await mockChainlink.setPrevPrice(dec(123, 6))
    await mockChainlink.setPrice(dec(123, 6))

    await th.fastForwardTime(CHAINLINK_FROZEN_TIME, web3.currentProvider) // Fast forward 4 hours

    // check Chainlink price timestamp is out of date by > 4 hours
    now = await th.getLatestBlockTimestamp(web3)
    const chainlinkUpdateTime = (await mockChainlink.latestRoundData())[3]
    assert.isTrue(chainlinkUpdateTime.lt(toBN(now).sub(toBN(14400))))

    // pyth price is current
    await mockPyth.mockPrices(PRICE_ID, BigInt(mockPrice), 0, -8, BigInt(mockPrice), 0, BigInt(now))

    await priceFeed.fetchPrice(DEFAULT_PRICE_FEED_DATA, { from: alice })
    const price = await priceFeed.lastGoodPrice()

    assert.equal(price, dec(246, 18))
  })
  
  // Using Chainlink, both Pyth & Chainlink go live

  it("C2 usingChainlinkPythUntrusted: both Chainlink and Pyth are live and <= 5% price difference - switch to pythWorking", async () => {
    await setAddresses()
    priceFeed.setStatus(1) // status 1: using Chainlink, Pyth untrusted
  
    await mockChainlink.setDecimals(6)
    await mockChainlink.setPrevPrice(dec(100, 6))
    await mockChainlink.setPrice(dec(100, 6)) // price = 100

    let now = await th.getLatestBlockTimestamp(web3)
    let mockPrice = dec(105, 8) // price = 105: 5% difference from Chainlink
    await mockPyth.mockPrices(PRICE_ID, BigInt(mockPrice), 0, -8, BigInt(mockPrice), 0, BigInt(now))

    await priceFeed.fetchPrice(DEFAULT_PRICE_FEED_DATA, { from: alice })

    const status = await priceFeed.status()
    assert.equal(status, 0)  // status 0: Pyth working
  })

  it("C2 usingChainlinkPythUntrusted: both Chainlink and Pyth are live and <= 5% price difference - return Pyth price", async () => {
    await setAddresses()
    priceFeed.setStatus(1) // status 1: using Chainlink, Pyth untrusted
  
    await mockChainlink.setDecimals(6)
    await mockChainlink.setPrevPrice(dec(100, 6))
    await mockChainlink.setPrice(dec(100, 6)) // price = 100

    let now = await th.getLatestBlockTimestamp(web3)
    let mockPrice = dec(105, 8) // price = 105: 5% difference from Chainlink
    await mockPyth.mockPrices(PRICE_ID, BigInt(mockPrice), 0, -8, BigInt(mockPrice), 0, BigInt(now))

    await priceFeed.fetchPrice(DEFAULT_PRICE_FEED_DATA, { from: alice })

    const price = await priceFeed.lastGoodPrice()
    assert.equal(price, dec(105, 18))
  })

  it("C2 usingChainlinkPythUntrusted: both Chainlink and Pyth are live and > 5% price difference - remain usingChainlinkPythUntrusted", async () => {
    await setAddresses()
    priceFeed.setStatus(1) // status 1: using Chainlink, Pyth untrusted

    await mockChainlink.setDecimals(6)
    await mockChainlink.setPrevPrice(dec(100, 6))
    await mockChainlink.setPrice(dec(100, 6)) // price = 100

    let now = await th.getLatestBlockTimestamp(web3)
    let mockPrice = '10500000001' // price = 105.00000001: > 5% difference from Chainlink
    await mockPyth.mockPrices(PRICE_ID, BigInt(mockPrice), 0, -8, BigInt(mockPrice), 0, BigInt(now))

    await priceFeed.fetchPrice(DEFAULT_PRICE_FEED_DATA, { from: alice })
   
    const status = await priceFeed.status()
    assert.equal(status, 1)  // status 1: using Chainlink, Pyth untrusted
  })

  it("C2 usingChainlinkPythUntrusted: both Chainlink and Pyth are live and > 5% price difference - return Chainlink price", async () => {
    await setAddresses()
    priceFeed.setStatus(1) // status 1: using Chainlink, Pyth untrusted

    await mockChainlink.setDecimals(6)
    await mockChainlink.setPrevPrice(dec(100, 6))
    await mockChainlink.setPrice(dec(100, 6)) // price = 100

    let now = await th.getLatestBlockTimestamp(web3)
    let mockPrice = '10500000001' // price = 105.00000001: > 5% difference from Chainlink
    await mockPyth.mockPrices(PRICE_ID, BigInt(mockPrice), 0, -8, BigInt(mockPrice), 0, BigInt(now))

    await priceFeed.fetchPrice(DEFAULT_PRICE_FEED_DATA, { from: alice })

    const price = await priceFeed.lastGoodPrice()
    assert.equal(price, dec(100, 18))
  })


  // --- Case 3: Both Oracles suspect

  it("C3 bothOraclesUntrusted: both Pyth and Chainlink are live and > 5% price difference remain bothOraclesSuspect", async () => {
    await setAddresses()
    priceFeed.setStatus(2) // status 2: both oracles untrusted

    await priceFeed.setLastGoodPrice(dec(50, 18))

    await mockChainlink.setDecimals(6)
    await mockChainlink.setPrevPrice(dec(100, 6))
    await mockChainlink.setPrice(dec(100, 6)) // price = 100

    let now = await th.getLatestBlockTimestamp(web3)
    let mockPrice = '10500000001' // price = 105.00000001: > 5% difference from Chainlink
    await mockPyth.mockPrices(PRICE_ID, BigInt(mockPrice), 0, -8, BigInt(mockPrice), 0, BigInt(now))

    const status = await priceFeed.status()
    assert.equal(status, 2)  // status 2: both oracles untrusted
  })

  it("C3 bothOraclesUntrusted: both Pyth and Chainlink are live and > 5% price difference, return last good price", async () => {
    await setAddresses()
    priceFeed.setStatus(2) // status 2: both oracles untrusted

    await priceFeed.setLastGoodPrice(dec(50, 18))

    await mockChainlink.setDecimals(6)
    await mockChainlink.setPrevPrice(dec(100, 6))
    await mockChainlink.setPrice(dec(100, 6)) // price = 100

    let now = await th.getLatestBlockTimestamp(web3)
    let mockPrice = '10500000001' // price = 105.00000001: > 5% difference from Chainlink
    await mockPyth.mockPrices(PRICE_ID, BigInt(mockPrice), 0, -8, BigInt(mockPrice), 0, BigInt(now))

    await priceFeed.fetchPrice(DEFAULT_PRICE_FEED_DATA, { from: alice })
    const price = await priceFeed.lastGoodPrice()

    assert.equal(price, dec(50, 18))
  })

  it("C3 bothOraclesUntrusted: both Pyth and Chainlink are live and <= 5% price difference, switch to chainlinkWorking", async () => {
    await setAddresses()
    priceFeed.setStatus(2) // status 2: both oracles untrusted

    await mockChainlink.setDecimals(6)
    await mockChainlink.setPrevPrice(dec(100, 6))
    await mockChainlink.setPrice(dec(100, 6)) // price = 100

    let now = await th.getLatestBlockTimestamp(web3)
    let mockPrice = dec(105, 8) // price = 105: 5% difference from Chainlink
    await mockPyth.mockPrices(PRICE_ID, BigInt(mockPrice), 0, -8, BigInt(mockPrice), 0, BigInt(now))

    await priceFeed.fetchPrice(DEFAULT_PRICE_FEED_DATA, { from: alice })

    const status = await priceFeed.status()
    assert.equal(status, 0)  // status 0: Pyth working
  })

  it("C3 bothOraclesUntrusted: both Pyth and Chainlink are live and <= 5% price difference, return Pyth price", async () => {
    await setAddresses()
    priceFeed.setStatus(2) // status 2: both oracles untrusted

    await mockChainlink.setDecimals(6)
    await mockChainlink.setPrevPrice(dec(100, 6))
    await mockChainlink.setPrice(dec(100, 6)) // price = 100

    let now = await th.getLatestBlockTimestamp(web3)
    let mockPrice = dec(105, 8) // price = 105: 5% difference from Chainlink
    await mockPyth.mockPrices(PRICE_ID, BigInt(mockPrice), 0, -8, BigInt(mockPrice), 0, BigInt(now))

    await priceFeed.fetchPrice(DEFAULT_PRICE_FEED_DATA, { from: alice })

    const price = await priceFeed.lastGoodPrice()
    assert.equal(price, dec(105, 18))
  })

  // --- Case 4 ---
  it("C4 usingChainlinkPythFrozen: when both Pyth and Chainlink break, switch to bothOraclesSuspect", async () => { 
    await setAddresses()
    priceFeed.setStatus(3) // status 3: using Chainlink, Pyth frozen

    let now = await th.getLatestBlockTimestamp(web3)
    let mockPrice = dec(999, 8)
    await mockPyth.mockPrices(PRICE_ID, BigInt(mockPrice), 0, -8, BigInt(mockPrice), 0, BigInt(now))

    // Both Pyth and Chainlink break with 0 price
    await mockChainlink.setPrice(0)

    now = await th.getLatestBlockTimestamp(web3)
    mockPrice = 0
    await mockPyth.mockPrices(PRICE_ID, BigInt(mockPrice), 0, -8, BigInt(mockPrice), 0, BigInt(now))

    await priceFeed.fetchPrice(DEFAULT_PRICE_FEED_DATA, { from: alice })

    const status = await priceFeed.status()
    assert.equal(status, 2)  // status 2: both oracles untrusted
  })

  it("C4 usingChainlinkPythFrozen: when both Pyth and Chainlink break, return last good price", async () => { 
    await setAddresses()
    priceFeed.setStatus(2) // status 2: using Chainlink, Pyth break

    await priceFeed.setLastGoodPrice(dec(50, 18))

    let now = await th.getLatestBlockTimestamp(web3)
    let mockPrice = dec(999, 8)
    await mockPyth.mockPrices(PRICE_ID, BigInt(mockPrice), 0, -8, BigInt(mockPrice), 0, BigInt(now))

    // Both Pyth and Chainlink break with 0 price
    await mockChainlink.setPrice(0)

    now = await th.getLatestBlockTimestamp(web3)
    mockPrice = 0
    await mockPyth.mockPrices(PRICE_ID, BigInt(mockPrice), 0, -8, BigInt(mockPrice), 0, BigInt(now))

    await priceFeed.fetchPrice(DEFAULT_PRICE_FEED_DATA, { from: alice })

    const price = await priceFeed.lastGoodPrice()
    assert.equal(price, dec(50, 18))
  })

  it("C4 usingChainlinkPythFrozen: when Pyth breaks and Chainlink freezes, switch to usingChainlinkPythUntrusted", async () => { 
    await setAddresses()
    priceFeed.setStatus(3) // status 3: using Chainlink, Pyth frozen

    await priceFeed.setLastGoodPrice(dec(50, 18))

    let now = await th.getLatestBlockTimestamp(web3)
    let mockPrice = dec(999, 8)
    await mockPyth.mockPrices(PRICE_ID, BigInt(mockPrice), 0, -8, BigInt(mockPrice), 0, BigInt(now))

    // Pyth breaks
    now = await th.getLatestBlockTimestamp(web3)
    mockPrice = 0
    await mockPyth.mockPrices(PRICE_ID, BigInt(mockPrice), 0, -8, BigInt(mockPrice), 0, BigInt(now))

    await mockChainlink.setDecimals(6)
    await mockChainlink.setPrevPrice(dec(123, 6))
    await mockChainlink.setPrice(dec(123, 6))

    await th.fastForwardTime(CHAINLINK_FROZEN_TIME, web3.currentProvider) // Fast forward 4 hours

    // check Chainlink price timestamp is out of date by > 4 hours
    now = await th.getLatestBlockTimestamp(web3)
    const chainlinkUpdateTime = (await mockChainlink.latestRoundData())[3]
    assert.isTrue(chainlinkUpdateTime.lt(toBN(now).sub(toBN(14400))))

    await priceFeed.fetchPrice(DEFAULT_PRICE_FEED_DATA, { from: alice })

    const status = await priceFeed.status()
    assert.equal(status, 1)  // status 1: using Chainlink, Pyth untrusted
  })

  it("C4 usingChainlinkPythFrozen: when Pyth breaks and Chainlink freezes, return last good price", async () => { 
    await setAddresses()
    priceFeed.setStatus(3) // status 3: using Chainlink, Pyth frozen

    await priceFeed.setLastGoodPrice(dec(50, 18))

    let now = await th.getLatestBlockTimestamp(web3)
    let mockPrice = dec(999, 8)
    await mockPyth.mockPrices(PRICE_ID, BigInt(mockPrice), 0, -8, BigInt(mockPrice), 0, BigInt(now))

    // Pyth breaks
    now = await th.getLatestBlockTimestamp(web3)
    mockPrice = 0
    await mockPyth.mockPrices(PRICE_ID, BigInt(mockPrice), 0, -8, BigInt(mockPrice), 0, BigInt(now))

    await mockChainlink.setDecimals(6)
    await mockChainlink.setPrevPrice(dec(123, 6))
    await mockChainlink.setPrice(dec(123, 6))

    await th.fastForwardTime(CHAINLINK_FROZEN_TIME, web3.currentProvider) // Fast forward 4 hours

    // check Chainlink price timestamp is out of date by > 4 hours
    now = await th.getLatestBlockTimestamp(web3)
    const chainlinkUpdateTime = (await mockChainlink.latestRoundData())[3]
    assert.isTrue(chainlinkUpdateTime.lt(toBN(now).sub(toBN(14400))))

    await priceFeed.fetchPrice(DEFAULT_PRICE_FEED_DATA, { from: alice })

    const price = await priceFeed.lastGoodPrice()
    assert.equal(price, dec(50, 18))
  })

  it("C4 usingChainlinkPythFrozen: when Pyth breaks and Chainlink live, switch to usingChainlinkPythUntrusted", async () => { 
    await setAddresses()
    priceFeed.setStatus(3) // status 3: using Chainlink, Pyth frozen

    await priceFeed.setLastGoodPrice(dec(50, 18))

    let now = await th.getLatestBlockTimestamp(web3)
    let mockPrice = dec(999, 8)
    await mockPyth.mockPrices(PRICE_ID, BigInt(mockPrice), 0, -8, BigInt(mockPrice), 0, BigInt(now))

    // Pyth breaks
    now = await th.getLatestBlockTimestamp(web3)
    mockPrice = 0
    await mockPyth.mockPrices(PRICE_ID, BigInt(mockPrice), 0, -8, BigInt(mockPrice), 0, BigInt(now))

    await mockChainlink.setDecimals(6)
    await mockChainlink.setPrevPrice(dec(123, 6))
    await mockChainlink.setPrice(dec(123, 6))

    await th.fastForwardTime(CHAINLINK_FROZEN_TIME, web3.currentProvider) // Fast forward 4 hours

    await priceFeed.fetchPrice(DEFAULT_PRICE_FEED_DATA, { from: alice })

    const status = await priceFeed.status()
    assert.equal(status, 1)  // status 1: using Chainlink, Pyth untrusted
  })

  it("C4 usingChainlinkPythFrozen: when Pyth breaks and Chainlink live, return Chainlink price", async () => { 
    await setAddresses()
    priceFeed.setStatus(3) // status 3: using Chainlink, Pyth frozen

    await priceFeed.setLastGoodPrice(dec(50, 18))

    let now = await th.getLatestBlockTimestamp(web3)
    let mockPrice = dec(999, 8)
    await mockPyth.mockPrices(PRICE_ID, BigInt(mockPrice), 0, -8, BigInt(mockPrice), 0, BigInt(now))

    // Pyth breaks
    now = await th.getLatestBlockTimestamp(web3)
    mockPrice = 0
    await mockPyth.mockPrices(PRICE_ID, BigInt(mockPrice), 0, -8, BigInt(mockPrice), 0, BigInt(now))

    await mockChainlink.setDecimals(6)
    await mockChainlink.setPrevPrice(dec(123, 6))
    await mockChainlink.setPrice(dec(123, 6))

    await priceFeed.fetchPrice(DEFAULT_PRICE_FEED_DATA, { from: alice })

    const price = await priceFeed.lastGoodPrice()
    assert.equal(price, dec(123, 18))
  })

  it("C4 usingChainlinkPythFrozen: when Pyth is live and Chainlink is live with <5% price difference, switch back to pythWorking", async () => { 
    await setAddresses()
    priceFeed.setStatus(3) // status 3: using Chainlink, Pyth frozen

    await priceFeed.setLastGoodPrice(dec(50, 18))

    let now = await th.getLatestBlockTimestamp(web3)
    let mockPrice = dec(999, 8)
    await mockPyth.mockPrices(PRICE_ID, BigInt(mockPrice), 0, -8, BigInt(mockPrice), 0, BigInt(now))

    await mockChainlink.setDecimals(6)
    await mockChainlink.setPrevPrice(dec(998, 6))
    await mockChainlink.setPrice(dec(998, 6))

    await priceFeed.fetchPrice(DEFAULT_PRICE_FEED_DATA, { from: alice })

    const status = await priceFeed.status()
    assert.equal(status, 0)  // status 0: Pyth working
  })

  it("C4 usingChainlinkPythFrozen: when Pyth is live and Chainlink is live with <5% price difference, return Pyth current price", async () => { 
    await setAddresses()
    priceFeed.setStatus(3) // status 3: using Chainlink, Pyth frozen

    await priceFeed.setLastGoodPrice(dec(50, 18))

    let now = await th.getLatestBlockTimestamp(web3)
    let mockPrice = dec(999, 8)
    await mockPyth.mockPrices(PRICE_ID, BigInt(mockPrice), 0, -8, BigInt(mockPrice), 0, BigInt(now))

    await mockChainlink.setDecimals(6)
    await mockChainlink.setPrevPrice(dec(998, 6))
    await mockChainlink.setPrice(dec(998, 6))

    await priceFeed.fetchPrice(DEFAULT_PRICE_FEED_DATA, { from: alice })

    const price = await priceFeed.lastGoodPrice()
    assert.equal(price, dec(999, 18))  // Pyth price
  })

  it("C4 usingChainlinkPythFrozen: when Pyth is live and Chainlink is live with >5% price difference, switch back to usingChainlinkPythUntrusted", async () => { 
    await setAddresses()
    priceFeed.setStatus(3) // status 3: using Chainlink, Pyth frozen

    await priceFeed.setLastGoodPrice(dec(50, 18))

    let now = await th.getLatestBlockTimestamp(web3)
    let mockPrice = dec(999, 8)
    await mockPyth.mockPrices(PRICE_ID, BigInt(mockPrice), 0, -8, BigInt(mockPrice), 0, BigInt(now))

    await mockChainlink.setDecimals(6)
    await mockChainlink.setPrevPrice(dec(123, 6))
    await mockChainlink.setPrice(dec(123, 6))

    await priceFeed.fetchPrice(DEFAULT_PRICE_FEED_DATA, { from: alice })

    const status = await priceFeed.status()
    assert.equal(status, 1)  // status 1: Using Chainlink, Pyth untrusted
  })

  it("C4 usingChainlinkPythFrozen: when Pyth is live and Chainlink is live with >5% price difference, return Chainlink current price", async () => { 
    await setAddresses()
    priceFeed.setStatus(3) // status 3: using Chainlink, Pyth frozen

    await priceFeed.setLastGoodPrice(dec(50, 18))

    let now = await th.getLatestBlockTimestamp(web3)
    let mockPrice = dec(999, 8)
    await mockPyth.mockPrices(PRICE_ID, BigInt(mockPrice), 0, -8, BigInt(mockPrice), 0, BigInt(now))

    await mockChainlink.setDecimals(6)
    await mockChainlink.setPrevPrice(dec(123, 6))
    await mockChainlink.setPrice(dec(123, 6))

    await priceFeed.fetchPrice(DEFAULT_PRICE_FEED_DATA, { from: alice })

    const price = await priceFeed.lastGoodPrice()
    assert.equal(price, dec(123, 18))  // Chainlink price
  })

  it("C4 usingChainlinkPythFrozen: when Pyth is live and Chainlink is live with similar price, switch back to pythWorking", async () => { 
    await setAddresses()
    priceFeed.setStatus(3) // status 3: using Chainlink, Pyth frozen

    await priceFeed.setLastGoodPrice(dec(50, 18))

    let now = await th.getLatestBlockTimestamp(web3)
    let mockPrice = dec(999, 8)
    await mockPyth.mockPrices(PRICE_ID, BigInt(mockPrice), 0, -8, BigInt(mockPrice), 0, BigInt(now))

    await mockChainlink.setDecimals(6)
    await mockChainlink.setPrevPrice(dec(998, 6))
    await mockChainlink.setPrice(dec(998, 6))

    await priceFeed.fetchPrice(DEFAULT_PRICE_FEED_DATA, { from: alice })

    const status = await priceFeed.status()
    assert.equal(status, 0)  // status 0: Pyth working
  })

  it("C4 usingChainlinkPythFrozen: when Pyth is live and Chainlink is live with similar price, return Pyth current price", async () => { 
    await setAddresses()
    priceFeed.setStatus(3) // status 3: using Chainlink, Pyth frozen

    await priceFeed.setLastGoodPrice(dec(50, 18))

    let now = await th.getLatestBlockTimestamp(web3)
    let mockPrice = dec(999, 8)
    await mockPyth.mockPrices(PRICE_ID, BigInt(mockPrice), 0, -8, BigInt(mockPrice), 0, BigInt(now))

    await mockChainlink.setDecimals(6)
    await mockChainlink.setPrevPrice(dec(998, 6))
    await mockChainlink.setPrice(dec(998, 6))

    await priceFeed.fetchPrice(DEFAULT_PRICE_FEED_DATA, { from: alice })

    const price = await priceFeed.lastGoodPrice()
    assert.equal(price, dec(999, 18))  // Pyth price
  })

  it("C4 usingChainlinkPythFrozen: when Pyth is live and Chainlink breaks, switch to usingPythChainlinkUntrusted", async () => { 
    await setAddresses()
    priceFeed.setStatus(3) // status 3: using Chainlink, Pyth frozen

    await priceFeed.setLastGoodPrice(dec(50, 18))

    let now = await th.getLatestBlockTimestamp(web3)
    let mockPrice = dec(999, 8)
    await mockPyth.mockPrices(PRICE_ID, BigInt(mockPrice), 0, -8, BigInt(mockPrice), 0, BigInt(now))

    await mockChainlink.setPrice(0)

    await priceFeed.fetchPrice(DEFAULT_PRICE_FEED_DATA, { from: alice })

    const status = await priceFeed.status()
    assert.equal(status, 4)  // status 4: Using Pyth, Chainlink untrusted
  })

  it("C4 usingChainlinkPythFrozen: when Pyth is live and Chainlink breaks, return Pyth current price", async () => { 
    await setAddresses()
    priceFeed.setStatus(3) // status 3: using Chainlink, Pyth frozen

    await priceFeed.setLastGoodPrice(dec(50, 18))

    let now = await th.getLatestBlockTimestamp(web3)
    let mockPrice = dec(999, 8)
    await mockPyth.mockPrices(PRICE_ID, BigInt(mockPrice), 0, -8, BigInt(mockPrice), 0, BigInt(now))

    await mockChainlink.setPrice(0)

    await priceFeed.fetchPrice(DEFAULT_PRICE_FEED_DATA, { from: alice })

    const price = await priceFeed.lastGoodPrice()
    assert.equal(price, dec(999, 18))
  })

  it("C4 usingChainlinkPythFrozen: when Pyth still frozen and Chainlink breaks, switch to usingPythChainlinkUntrusted", async () => { 
    await setAddresses()
    priceFeed.setStatus(3) // status 3: using Chainlink, Pyth frozen

    await priceFeed.setLastGoodPrice(dec(50, 18))

    let now = await th.getLatestBlockTimestamp(web3)
    let mockPrice = dec(999, 8)
    await mockPyth.mockPrices(PRICE_ID, BigInt(mockPrice), 0, -8, BigInt(mockPrice), 0, BigInt(now))

    await th.fastForwardTime(PYTH_FROZEN_TIME, web3.currentProvider) // Fast forward 30 seconds

    // check Pyth price timestamp is out of date by > 30 seconds
    now = await th.getLatestBlockTimestamp(web3)
    const BNBFeed = await priceFeed.BNBFeed();
    const pythUpdateTime = (await mockPyth.queryPriceFeed(BNBFeed))[0][3]
    assert.isTrue(toBN(pythUpdateTime).lt(toBN(now).sub(toBN(PYTH_FROZEN_TIME))))

    // set Chainlink broken
    await mockChainlink.setPrice(0)

    await priceFeed.fetchPrice(DEFAULT_PRICE_FEED_DATA, { from: alice })

    const status = await priceFeed.status()
    assert.equal(status, 4)  // status 4: using Pyth, Chainlink untrusted
  })

  it("C4 usingChainlinkPythFrozen: when Pyth still frozen and Chainlink broken, return last good price", async () => { 
    await setAddresses()
    priceFeed.setStatus(3) // status 3: using Chainlink, Pyth frozen

    await priceFeed.setLastGoodPrice(dec(50, 18))

    let now = await th.getLatestBlockTimestamp(web3)
    let mockPrice = dec(999, 8)
    await mockPyth.mockPrices(PRICE_ID, BigInt(mockPrice), 0, -8, BigInt(mockPrice), 0, BigInt(now))

    await th.fastForwardTime(PYTH_FROZEN_TIME, web3.currentProvider) // Fast forward 30 seconds

    // check Pyth price timestamp is out of date by > 30 seconds
    now = await th.getLatestBlockTimestamp(web3)
    const BNBFeed = await priceFeed.BNBFeed();
    const pythUpdateTime = (await mockPyth.queryPriceFeed(BNBFeed))[0][3]
    assert.isTrue(toBN(pythUpdateTime).lt(toBN(now).sub(toBN(PYTH_FROZEN_TIME))))

    // set Chainlink broken
    await mockChainlink.setPrice(0)

    await priceFeed.fetchPrice(DEFAULT_PRICE_FEED_DATA, { from: alice })

    const price = await priceFeed.lastGoodPrice()
    assert.equal(price, dec(50, 18))
  })

  it("C4 usingChainlinkPythFrozen: when Pyth still frozen and Chainlink live, remain usingChainlinkPythFrozen", async () => { 
    await setAddresses()
    priceFeed.setStatus(3) // status 3: using Chainlink, Pyth frozen

    await priceFeed.setLastGoodPrice(dec(50, 18))

    let now = await th.getLatestBlockTimestamp(web3)
    let mockPrice = dec(999, 8)
    await mockPyth.mockPrices(PRICE_ID, BigInt(mockPrice), 0, -8, BigInt(mockPrice), 0, BigInt(now))

    await mockChainlink.setDecimals(6)
    await mockChainlink.setPrevPrice(dec(123, 6))
    await mockChainlink.setPrice(dec(123, 6))

    await th.fastForwardTime(PYTH_FROZEN_TIME, web3.currentProvider) // Fast forward 30 seconds

    // check Pyth price timestamp is out of date by > 30 seconds
    now = await th.getLatestBlockTimestamp(web3)
    const BNBFeed = await priceFeed.BNBFeed();
    const pythUpdateTime = (await mockPyth.queryPriceFeed(BNBFeed))[0][3]
    assert.isTrue(toBN(pythUpdateTime).lt(toBN(now).sub(toBN(PYTH_FROZEN_TIME))))

    // set Chainlink to current time
    await mockChainlink.setUpdateTime(now)

    await priceFeed.fetchPrice(DEFAULT_PRICE_FEED_DATA, { from: alice })

    const status = await priceFeed.status()
    assert.equal(status, 3)  // status 3: using Chainlink, Pyth frozen
  })

  it("C4 usingChainlinkPythFrozen: when Pyth still frozen and Chainlink live, return Chainlink price", async () => { 
    await setAddresses()
    priceFeed.setStatus(3) // status 3: using Chainlink, Pyth frozen

    await priceFeed.setLastGoodPrice(dec(50, 18))

    let now = await th.getLatestBlockTimestamp(web3)
    let mockPrice = dec(999, 8)
    await mockPyth.mockPrices(PRICE_ID, BigInt(mockPrice), 0, -8, BigInt(mockPrice), 0, BigInt(now))

    await mockChainlink.setDecimals(6)
    await mockChainlink.setPrevPrice(dec(123, 6))
    await mockChainlink.setPrice(dec(123, 6))

    await th.fastForwardTime(PYTH_FROZEN_TIME, web3.currentProvider) // Fast forward 30 seconds

    // check Pyth price timestamp is out of date by > 30 seconds
    now = await th.getLatestBlockTimestamp(web3)
    const BNBFeed = await priceFeed.BNBFeed();
    const pythUpdateTime = (await mockPyth.queryPriceFeed(BNBFeed))[0][3]
    assert.isTrue(toBN(pythUpdateTime).lt(toBN(now).sub(toBN(PYTH_FROZEN_TIME))))

    // set Chainlink to current time
    await mockChainlink.setUpdateTime(now)

    await priceFeed.fetchPrice(DEFAULT_PRICE_FEED_DATA, { from: alice })

    const price = await priceFeed.lastGoodPrice()
    assert.equal(price, dec(123, 18))
  })

  it("C4 usingChainlinkPythFrozen: when Pyth still frozen and Chainlink freezes, remain usingChainlinkPythFrozen", async () => { 
    await setAddresses()
    priceFeed.setStatus(3) // status 3: using Chainlink, Pyth frozen

    await priceFeed.setLastGoodPrice(dec(50, 18))

    let now = await th.getLatestBlockTimestamp(web3)
    let mockPrice = dec(999, 8)
    await mockPyth.mockPrices(PRICE_ID, BigInt(mockPrice), 0, -8, BigInt(mockPrice), 0, BigInt(now))

    await mockChainlink.setDecimals(6)
    await mockChainlink.setPrevPrice(dec(123, 6))
    await mockChainlink.setPrice(dec(123, 6))

    await th.fastForwardTime(CHAINLINK_FROZEN_TIME, web3.currentProvider) // Fast forward 4 hours

    // pyth price is current
    now = await th.getLatestBlockTimestamp(web3)
    await mockPyth.mockPrices(PRICE_ID, BigInt(mockPrice), 0, -8, BigInt(mockPrice), 0, BigInt(now))

    await th.fastForwardTime(PYTH_FROZEN_TIME, web3.currentProvider) // Fast forward 4 hours

    // check Pyth price timestamp is out of date by > 30 seconds
    now = await th.getLatestBlockTimestamp(web3)
    const BNBFeed = await priceFeed.BNBFeed();
    const pythUpdateTime = (await mockPyth.queryPriceFeed(BNBFeed))[0][3]
    assert.isTrue(toBN(pythUpdateTime).lt(toBN(now).sub(toBN(PYTH_FROZEN_TIME))))

     // check Chainlink price timestamp is out of date by > 4 hours
    const chainlinkUpdateTime = (await mockChainlink.latestRoundData())[3]
    assert.isTrue(chainlinkUpdateTime.lt(toBN(now).sub(toBN(CHAINLINK_FROZEN_TIME))))

    await priceFeed.fetchPrice(DEFAULT_PRICE_FEED_DATA, { from: alice })

    const status = await priceFeed.status()
    assert.equal(status, 3)  // status 3: using Chainlink, Pyth frozen
  })

  it("C4 usingChainlinkPythFrozen: when Pyth still frozen and Chainlink freezes, return last good price", async () => { 
    await setAddresses()
    priceFeed.setStatus(3) // status 3: using Chainlink, Pyth frozen

    await priceFeed.setLastGoodPrice(dec(50, 18))

    let now = await th.getLatestBlockTimestamp(web3)
    let mockPrice = dec(999, 8)
    await mockPyth.mockPrices(PRICE_ID, BigInt(mockPrice), 0, -8, BigInt(mockPrice), 0, BigInt(now))

    await mockChainlink.setDecimals(6)
    await mockChainlink.setPrevPrice(dec(123, 6))
    await mockChainlink.setPrice(dec(123, 6))

    await th.fastForwardTime(CHAINLINK_FROZEN_TIME, web3.currentProvider) // Fast forward 4 hours

    // pyth price is current
    now = await th.getLatestBlockTimestamp(web3)
    await mockPyth.mockPrices(PRICE_ID, BigInt(mockPrice), 0, -8, BigInt(mockPrice), 0, BigInt(now))

    await th.fastForwardTime(PYTH_FROZEN_TIME, web3.currentProvider) // Fast forward 4 hours

    // check Pyth price timestamp is out of date by > 30 seconds
    now = await th.getLatestBlockTimestamp(web3)
    const BNBFeed = await priceFeed.BNBFeed();
    const pythUpdateTime = (await mockPyth.queryPriceFeed(BNBFeed))[0][3]
    assert.isTrue(toBN(pythUpdateTime).lt(toBN(now).sub(toBN(PYTH_FROZEN_TIME))))

     // check Chainlink price timestamp is out of date by > 4 hours
    const chainlinkUpdateTime = (await mockChainlink.latestRoundData())[3]
    assert.isTrue(chainlinkUpdateTime.lt(toBN(now).sub(toBN(CHAINLINK_FROZEN_TIME))))

    await priceFeed.fetchPrice(DEFAULT_PRICE_FEED_DATA, { from: alice })

    const price = await priceFeed.lastGoodPrice()
    assert.equal(price, dec(50, 18))
  })



  // --- Case 5 ---
  it("C5 usingPythChainlinkUntrusted: when Pyth is live and Chainlink price >5% - no status change", async () => {
    await setAddresses()
    priceFeed.setStatus(4) // status 4: using Pyth, Chainlink untrusted

    await priceFeed.setLastGoodPrice(dec(246, 18))

    let now = await th.getLatestBlockTimestamp(web3)
    let mockPrice = dec(999, 8)
    await mockPyth.mockPrices(PRICE_ID, BigInt(mockPrice), 0, -8, BigInt(mockPrice), 0, BigInt(now))

    await mockChainlink.setDecimals(6)
    await mockChainlink.setPrevPrice(dec(123, 6))
    await mockChainlink.setPrice(dec(123, 6)) // Greater than 5% difference with Pyth

    await priceFeed.fetchPrice(DEFAULT_PRICE_FEED_DATA, { from: alice })

    const status = await priceFeed.status()
    assert.equal(status, 4)  // status 4: using Pyth, Chainlink untrusted
  })

  it("C5 usingPythChainlinkUntrusted: when Pyth is live and Chainlink price >5% - return Pyth price", async () => {
    await setAddresses()
    priceFeed.setStatus(4) // status 4: using Pyth, Chainlink untrusted

    await priceFeed.setLastGoodPrice(dec(246, 18))

    let now = await th.getLatestBlockTimestamp(web3)
    let mockPrice = dec(999, 8)
    await mockPyth.mockPrices(PRICE_ID, BigInt(mockPrice), 0, -8, BigInt(mockPrice), 0, BigInt(now))

    await mockChainlink.setDecimals(6)
    await mockChainlink.setPrevPrice(dec(123, 6))
    await mockChainlink.setPrice(dec(123, 6)) // Greater than 5% difference with Pyth

    await priceFeed.fetchPrice(DEFAULT_PRICE_FEED_DATA, { from: alice })

    const price = await priceFeed.lastGoodPrice()
    assert.equal(price.toString(), dec(999, 18))
  })

  it("C5 usingPythChainlinkUntrusted: when Pyth is live and Chainlink price within <5%, switch to pythWorking", async () => {
    await setAddresses()
    priceFeed.setStatus(4) // status 4: using Pyth, Chainlink untrusted

    await priceFeed.setLastGoodPrice(dec(246, 18))

    let now = await th.getLatestBlockTimestamp(web3)
    let mockPrice = dec(999, 8)
    await mockPyth.mockPrices(PRICE_ID, BigInt(mockPrice), 0, -8, BigInt(mockPrice), 0, BigInt(now))

    await mockChainlink.setDecimals(6)
    await mockChainlink.setPrevPrice(dec(998, 6))
    await mockChainlink.setPrice(dec(998, 6)) // within 5% of Pyth price

    await priceFeed.fetchPrice(DEFAULT_PRICE_FEED_DATA, { from: alice })

    const status = await priceFeed.status()
    assert.equal(status, 0)  // status 0: Pyth working
  })

  it("C5 usingPythChainlinkUntrusted: when Pyth is live, Chainlink price within 5%, return Pyth price", async () => {
    await setAddresses()
    priceFeed.setStatus(4) // status 4: using Pyth, Chainlink untrusted

    await priceFeed.setLastGoodPrice(dec(246, 18))

    let now = await th.getLatestBlockTimestamp(web3)
    let mockPrice = dec(999, 8)
    await mockPyth.mockPrices(PRICE_ID, BigInt(mockPrice), 0, -8, BigInt(mockPrice), 0, BigInt(now))

    await mockChainlink.setDecimals(6)
    await mockChainlink.setPrevPrice(dec(998, 6))
    await mockChainlink.setPrice(dec(998, 6)) // within 5% of Pyth price

    await priceFeed.fetchPrice(DEFAULT_PRICE_FEED_DATA, { from: alice })

    const price = await priceFeed.lastGoodPrice()
    assert.equal(price, dec(999, 18))
  })

  // ---------

  it("C5 usingPythChainlinkUntrusted: when Pyth is live, Chainlink price not within 5%, remain on usingPythChainlinkUntrusted", async () => {
    await setAddresses()
    priceFeed.setStatus(4) // status 4: using Pyth, Chainlink untrusted

    await priceFeed.setLastGoodPrice(dec(246, 18))

    let now = await th.getLatestBlockTimestamp(web3)
    let mockPrice = dec(999, 8)
    await mockPyth.mockPrices(PRICE_ID, BigInt(mockPrice), 0, -8, BigInt(mockPrice), 0, BigInt(now))

    await mockChainlink.setDecimals(6)
    await mockChainlink.setPrevPrice(dec(123, 6))
    await mockChainlink.setPrice(dec(123, 6)) // not close to current Pyth price
 
    await priceFeed.fetchPrice(DEFAULT_PRICE_FEED_DATA, { from: alice })

    const status = await priceFeed.status()
    assert.equal(status, 4)  // status 4: using Pyth, Chainlink untrusted
  })

  it("C5 usingPythChainlinkUntrusted: when Pyth is live, Chainlink price not within 5%, return Pyth price", async () => {
    await setAddresses()
    priceFeed.setStatus(4) // status 4: using Pyth, Chainlink untrusted

    await priceFeed.setLastGoodPrice(dec(246, 18))

    let now = await th.getLatestBlockTimestamp(web3)
    let mockPrice = dec(998, 8)
    await mockPyth.mockPrices(PRICE_ID, BigInt(mockPrice), 0, -8, BigInt(mockPrice), 0, BigInt(now))

    await mockChainlink.setDecimals(6)
    await mockChainlink.setPrevPrice(dec(123, 6))
    await mockChainlink.setPrice(dec(123, 6)) // not close to current Pyth price

    await priceFeed.fetchPrice(DEFAULT_PRICE_FEED_DATA, { from: alice })

    const price = await priceFeed.lastGoodPrice()
    assert.equal(price, dec(998, 18))
  })

  it("C5 usingPythChainlinkUntrusted: when Pyth is live, deviationPyth > 0.25%, Chainlink price not within 5%, remain on usingPythChainlinkUntrusted", async () => {
    await setAddresses()
    priceFeed.setStatus(4) // status 4: using Pyth, Chainlink untrusted

    await priceFeed.setLastGoodPrice(dec(246, 18))

    // Make mock Pyth price deviate too much
    let now = await th.getLatestBlockTimestamp(web3)
    let mockPrice = dec(200, 8) // mockPrice = 200 USD
    const conf = dec(52, 8); // 26%
    await mockPyth.mockPrices(PRICE_ID, BigInt(mockPrice), conf, -8, BigInt(mockPrice), conf, BigInt(now))

    await mockChainlink.setDecimals(6)
    await mockChainlink.setPrice(dec(123, 6)) // Chainlink not close to current Pyth
    await mockChainlink.setPrevPrice(dec(123, 6)) 

    await priceFeed.fetchPrice(DEFAULT_PRICE_FEED_DATA, { from: alice })

    const status = await priceFeed.status()
    assert.equal(status, 2)  // status 2: both Oracles untrusted
  })

  it("C5 usingPythChainlinkUntrusted: when Pyth is live, deviationPyth > 0.25%, Chainlink price not within 5%, return last good price", async () => {
    await setAddresses()
    priceFeed.setStatus(4) // status 4: using Pyth, Chainlink untrusted

    await priceFeed.setLastGoodPrice(dec(246, 18))

    // Make mock Pyth price deviate too much
    let now = await th.getLatestBlockTimestamp(web3)
    let mockPrice = dec(200, 8) // mockPrice = 200 USD
    const conf = dec(52, 8); // 26%
    await mockPyth.mockPrices(PRICE_ID, BigInt(mockPrice), conf, -8, BigInt(mockPrice), conf, BigInt(now))

    await mockChainlink.setDecimals(6)
    await mockChainlink.setPrice(dec(123, 6)) // Chainlink not close to current Pyth
    await mockChainlink.setPrevPrice(dec(123, 6)) 

    await priceFeed.fetchPrice(DEFAULT_PRICE_FEED_DATA, { from: alice })

    const price = await priceFeed.lastGoodPrice()
    assert.equal(price, dec(246, 18)) // last good price 
  })

  // -------

  it("C5 usingPythChainlinkUntrusted: when Pyth is live, and Chainlink is frozen, remain on usingPythChainlinkUntrusted", async () => {
    await setAddresses()
    priceFeed.setStatus(4) // status 4: using Pyth, Chainlink untrusted

    await priceFeed.setLastGoodPrice(dec(246, 18))

    let now = await th.getLatestBlockTimestamp(web3)
    let mockPrice = dec(999, 8)
    await mockPyth.mockPrices(PRICE_ID, BigInt(mockPrice), 0, -8, BigInt(mockPrice), 0, BigInt(now))

    await mockChainlink.setDecimals(6)
    await mockChainlink.setPrevPrice(dec(123, 6))
    await mockChainlink.setPrice(dec(123, 6)) // not within 5% of Pyth price

    await th.fastForwardTime(CHAINLINK_FROZEN_TIME, web3.currentProvider) // fast forward 4 hours

    // check Chainlink price timestamp is out of date by > 4 hours
    now = await th.getLatestBlockTimestamp(web3)
    const chainlinkUpdateTime = (await mockChainlink.latestRoundData())[3]
    assert.isTrue(chainlinkUpdateTime.lt(toBN(now).sub(toBN(CHAINLINK_FROZEN_TIME))))

    mockPrice = dec(998, 8)
    await mockPyth.mockPrices(PRICE_ID, BigInt(mockPrice), 0, -8, BigInt(mockPrice), 0, BigInt(now)) // Pyth is current

    await priceFeed.fetchPrice(DEFAULT_PRICE_FEED_DATA, { from: alice })

    const status = await priceFeed.status()
    assert.equal(status, 4)  // status 4: using Pyth, Chainlink untrusted
  })

  it("C5 usingPythChainlinkUntrusted: when Pyth is live, Chainlink is frozen, return Pyth price", async () => {
    await setAddresses()
    priceFeed.setStatus(4) // status 4: using Pyth, Chainlink untrusted

    await priceFeed.setLastGoodPrice(dec(246, 18))

    let now = await th.getLatestBlockTimestamp(web3)
    let mockPrice = dec(999, 8)
    await mockPyth.mockPrices(PRICE_ID, BigInt(mockPrice), 0, -8, BigInt(mockPrice), 0, BigInt(now))

    await mockChainlink.setDecimals(6)
    await mockChainlink.setPrevPrice(dec(123, 6))
    await mockChainlink.setPrice(dec(123, 6)) // not within 5% of Pyth price

    await th.fastForwardTime(CHAINLINK_FROZEN_TIME, web3.currentProvider) // fast forward 4 hours

    // check Chainlink price timestamp is out of date by > 4 hours
    now = await th.getLatestBlockTimestamp(web3)
    const chainlinkUpdateTime = (await mockChainlink.latestRoundData())[3]
    assert.isTrue(chainlinkUpdateTime.lt(toBN(now).sub(toBN(CHAINLINK_FROZEN_TIME))))

    mockPrice = dec(998, 8)
    await mockPyth.mockPrices(PRICE_ID, BigInt(mockPrice), 0, -8, BigInt(mockPrice), 0, BigInt(now)) // Pyth is current

    await priceFeed.fetchPrice(DEFAULT_PRICE_FEED_DATA, { from: alice })

    const price = await priceFeed.lastGoodPrice()
    assert.equal(price, dec(998, 18))
  })

  it("C5 usingPythChainlinkUntrusted: when Pyth frozen, remain on usingPythChainlinkUntrusted", async () => {
    await setAddresses()
    priceFeed.setStatus(4) // status 4: using Pyth, Chainlink untrusted

    await priceFeed.setLastGoodPrice(dec(246, 18))

    let now = await th.getLatestBlockTimestamp(web3)
    let mockPrice = dec(999, 8)
    await mockPyth.mockPrices(PRICE_ID, BigInt(mockPrice), 0, -8, BigInt(mockPrice), 0, BigInt(now))

    await mockChainlink.setDecimals(6)
    await mockChainlink.setPrevPrice(dec(123, 6))
    await mockChainlink.setPrice(dec(123, 6)) // not within 5% of Pyth price

    await th.fastForwardTime(PYTH_FROZEN_TIME, web3.currentProvider) // Fast forward 30 seconds

    // check Pyth price timestamp is out of date by > 30 seconds
    now = await th.getLatestBlockTimestamp(web3)
    const BNBFeed = await priceFeed.BNBFeed();
    const pythUpdateTime = (await mockPyth.queryPriceFeed(BNBFeed))[0][3] 
    assert.isTrue(toBN(pythUpdateTime).lt(toBN(now).sub(toBN(PYTH_FROZEN_TIME))))

    await priceFeed.fetchPrice(DEFAULT_PRICE_FEED_DATA, { from: alice })

    const status = await priceFeed.status()
    assert.equal(status, 4) // status 4: using Pyth, Chainlink untrusted
  })

  it("C5 usingPythChainlinkUntrusted: when Pyth frozen, return last good price", async () => {
    await setAddresses()
    priceFeed.setStatus(4) // status 4: using Pyth, Chainlink untrusted

    await priceFeed.setLastGoodPrice(dec(246, 18))

    let now = await th.getLatestBlockTimestamp(web3)
    let mockPrice = dec(999, 8)
    await mockPyth.mockPrices(PRICE_ID, BigInt(mockPrice), 0, -8, BigInt(mockPrice), 0, BigInt(now))

    await mockChainlink.setDecimals(6)
    await mockChainlink.setPrevPrice(dec(123, 6))
    await mockChainlink.setPrice(dec(123, 6)) // not within 5% of Pyth price

    await th.fastForwardTime(PYTH_FROZEN_TIME, web3.currentProvider) // Fast forward 30 seconds

    // check Pyth price timestamp is out of date by > 30 seconds
    now = await th.getLatestBlockTimestamp(web3)
    const BNBFeed = await priceFeed.BNBFeed();
    const pythUpdateTime = (await mockPyth.queryPriceFeed(BNBFeed))[0][3] 
    assert.isTrue(toBN(pythUpdateTime).lt(toBN(now).sub(toBN(PYTH_FROZEN_TIME))))

    await priceFeed.fetchPrice(DEFAULT_PRICE_FEED_DATA, { from: alice })

    const price = await priceFeed.lastGoodPrice()
    assert.equal(price, dec(246, 18))
  })

  it("C5 usingPythChainlinkUntrusted: when Pyth breaks too, switch to bothOraclesSuspect", async () => {
    await setAddresses()
    priceFeed.setStatus(4) // status 4: using Pyth, Chainlink untrusted

    await priceFeed.setLastGoodPrice(dec(246, 18))

    let mockPrice = dec(999, 8)
    // Pyth breaks by 0 timestamp
    await mockPyth.mockPrices(PRICE_ID, BigInt(mockPrice), 0, -8, BigInt(mockPrice), 0, 0)

    await mockChainlink.setDecimals(6)
    await mockChainlink.setPrevPrice(dec(123, 6))
    await mockChainlink.setPrice(dec(123, 6))

    await priceFeed.fetchPrice(DEFAULT_PRICE_FEED_DATA, { from: alice })

    const status = await priceFeed.status()
    assert.equal(status, 2)  // status 2: both oracles untrusted
  })

  it("C5 usingPythChainlinkUntrusted: Pyth breaks too, return last good price", async () => {
    await setAddresses()
    priceFeed.setStatus(4) // status 4: using Pyth, Chainlink untrusted

    await priceFeed.setLastGoodPrice(dec(246, 18))

    let mockPrice = dec(999, 8)
    // Pyth breaks by 0 timestamp
    await mockPyth.mockPrices(PRICE_ID, BigInt(mockPrice), 0, -8, BigInt(mockPrice), 0, 0)

    await mockChainlink.setDecimals(6)
    await mockChainlink.setPrevPrice(dec(123, 6))
    await mockChainlink.setPrice(dec(123, 6))

    await priceFeed.fetchPrice(DEFAULT_PRICE_FEED_DATA, { from: alice })

    const price = await priceFeed.lastGoodPrice()
    assert.equal(price, dec(246, 18))
  })
})
