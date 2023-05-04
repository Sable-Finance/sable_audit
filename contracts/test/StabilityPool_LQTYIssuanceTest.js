const deploymentHelper = require("../utils/deploymentHelpers.js");
const testHelpers = require("../utils/testHelpers.js");

const DEFAULT_PRICE_FEED_DATA = testHelpers.DEFAULT_PRICE_FEED_DATA;
const { BN, time } = require("@openzeppelin/test-helpers");

const th = testHelpers.TestHelper;
const timeValues = testHelpers.TimeValues;
const dec = th.dec;
const toBN = th.toBN;
const getDifference = th.getDifference;
const REWARDS_PER_BLOCK = toBN(1e18);
const DECIMAL_PRECISION = toBN(1e18);

const TroveManagerTester = artifacts.require("TroveManagerTester");
const LUSDToken = artifacts.require("LUSDToken");

const GAS_PRICE = 10000000;

contract("StabilityPool - LQTY Rewards", async accounts => {
  const [
    owner,
    whale,
    A,
    B,
    C,
    D,
    E,
    F,
    G,
    H,
    defaulter_1,
    defaulter_2,
    defaulter_3,
    defaulter_4,
    defaulter_5,
    defaulter_6,
    frontEnd_1,
    frontEnd_2,
    frontEnd_3,
    funder
  ] = accounts;

  const [vaultAddress] = accounts.slice(999, 1000);

  let contracts;

  let priceFeed;
  let lusdToken;
  let stabilityPool;
  let sortedTroves;
  let troveManager;
  let borrowerOperations;
  let lqtyToken;
  let communityIssuanceTester;

  let communityLQTYSupply;
  let issuance_M1;
  let issuance_M2;
  let issuance_M3;
  let issuance_M4;
  let issuance_M5;
  let issuance_M6;

  const ZERO_ADDRESS = th.ZERO_ADDRESS;

  const getOpenTroveLUSDAmount = async totalDebt => th.getOpenTroveLUSDAmount(contracts, totalDebt);

  const openTrove = async params => th.openTrove(contracts, params);
  describe("LQTY Rewards", async () => {
    beforeEach(async () => {
      contracts = await deploymentHelper.deployLiquityCore();
      contracts.troveManager = await TroveManagerTester.new();
      contracts.lusdToken = await LUSDToken.new(
        contracts.troveManager.address,
        contracts.stabilityPool.address,
        contracts.borrowerOperations.address
      );
      const MINT_AMOUNT = toBN(dec(100000000, 18));
      const LQTYContracts = await deploymentHelper.deployLQTYTesterContractsHardhat(vaultAddress, MINT_AMOUNT);

      priceFeed = contracts.priceFeedTestnet;
      lusdToken = contracts.lusdToken;
      stabilityPool = contracts.stabilityPool;
      sortedTroves = contracts.sortedTroves;
      troveManager = contracts.troveManager;
      stabilityPool = contracts.stabilityPool;
      borrowerOperations = contracts.borrowerOperations;

      lqtyToken = LQTYContracts.lqtyToken;
      communityIssuanceTester = LQTYContracts.communityIssuance;

      ;
      await deploymentHelper.connectCoreContracts(contracts, LQTYContracts);
      await deploymentHelper.connectLQTYContractsToCore(LQTYContracts, contracts);

      await lqtyToken.transfer(communityIssuanceTester.address, toBN((1e19).toString()), {
        from: vaultAddress
      });

      // // funding PriceFeed contract
      await web3.eth.sendTransaction({ from: funder, to: priceFeed.address, value: 1000000000 });
    });

    // Simple case: 4 depositors, equal stake. No liquidations. No front-end.
    it("withdrawFromSP(): Depositors with equal initial deposit withdraw correct LQTY gain. No liquidations. No front end.", async () => {
      // Whale opens Trove with 10k ETH
      await borrowerOperations.openTrove(
        th._100pct,
        dec(10000, 18),
        whale,
        whale,
        DEFAULT_PRICE_FEED_DATA,
        { from: whale, value: dec(10000, "ether") }
      );

      await borrowerOperations.openTrove(th._100pct, dec(1, 22), A, A, DEFAULT_PRICE_FEED_DATA, {
        from: A,
        value: dec(100, "ether")
      });
      await borrowerOperations.openTrove(th._100pct, dec(1, 22), B, B, DEFAULT_PRICE_FEED_DATA, {
        from: B,
        value: dec(100, "ether")
      });
      await borrowerOperations.openTrove(th._100pct, dec(1, 22), C, C, DEFAULT_PRICE_FEED_DATA, {
        from: C,
        value: dec(100, "ether")
      });
      await borrowerOperations.openTrove(th._100pct, dec(1, 22), D, D, DEFAULT_PRICE_FEED_DATA, {
        from: D,
        value: dec(100, "ether")
      });

      // Check all LQTY balances are initially 0
      assert.equal(await lqtyToken.balanceOf(A), 0);
      assert.equal(await lqtyToken.balanceOf(B), 0);
      assert.equal(await lqtyToken.balanceOf(C), 0);

      // A, B, C deposit
      await stabilityPool.provideToSP(dec(1, 22), ZERO_ADDRESS, { from: A });
      await stabilityPool.provideToSP(dec(1, 22), ZERO_ADDRESS, { from: B });
      await stabilityPool.provideToSP(dec(1, 22), ZERO_ADDRESS, { from: C });
      // D deposits, triggering LQTY gains for A,B,C. Withdraws immediately after
      await stabilityPool.provideToSP(dec(1, 22), ZERO_ADDRESS, { from: D });

      await stabilityPool.withdrawFromSP(dec(1, 22), DEFAULT_PRICE_FEED_DATA, { from: A });
      const A_LQTYBalance = await lqtyToken.balanceOf(A);

      // Totals reward A
      const expecdRewardA = REWARDS_PER_BLOCK.add(REWARDS_PER_BLOCK.div(toBN("2")))
        .add(REWARDS_PER_BLOCK.div(toBN("3")))
        .add(REWARDS_PER_BLOCK.div(toBN("4")));
      assert.isAtMost(getDifference(A_LQTYBalance, expecdRewardA), 1e12);

      await stabilityPool.withdrawFromSP(dec(1, 22), DEFAULT_PRICE_FEED_DATA, { from: B });
      const B_LQTYBalance = await lqtyToken.balanceOf(B);
      const expecdRewardB = REWARDS_PER_BLOCK.div(toBN("2"))
        .add(REWARDS_PER_BLOCK.div(toBN("3")))
        .add(REWARDS_PER_BLOCK.div(toBN("4")))
        .add(REWARDS_PER_BLOCK.div(toBN("3")));
      assert.isAtMost(getDifference(B_LQTYBalance, expecdRewardB), 1e12);

      assert.equal(await lqtyToken.balanceOf(D), 0);
      await stabilityPool.withdrawFromSP(dec(1, 22), DEFAULT_PRICE_FEED_DATA, { from: D });
      const D_LQTYBalance = await lqtyToken.balanceOf(D);
      const expecdRewardD = REWARDS_PER_BLOCK.div(toBN("4"))
        .add(REWARDS_PER_BLOCK.div(toBN("3")))
        .add(REWARDS_PER_BLOCK.div(toBN("2")));
      assert.isAtMost(getDifference(D_LQTYBalance, expecdRewardD), 1e12);

      assert.equal(await lqtyToken.balanceOf(C), 0);
      await stabilityPool.withdrawFromSP(dec(1, 22), DEFAULT_PRICE_FEED_DATA, { from: C });
      const C_LQTYBalance = await lqtyToken.balanceOf(C);
      const expecdRewardC = REWARDS_PER_BLOCK.div(toBN("3"))
        .add(REWARDS_PER_BLOCK.div(toBN("4")))
        .add(REWARDS_PER_BLOCK.div(toBN("3")))
        .add(REWARDS_PER_BLOCK.div(toBN("2")))
        .add(REWARDS_PER_BLOCK);
      assert.isAtMost(getDifference(C_LQTYBalance, expecdRewardC), 1e12);
    });

    // 3 depositors, varied stake. No liquidations. No front-end.
    it("withdrawFromSP(): Depositors with varying initial deposit withdraw correct LQTY gain. No liquidations. No front end.", async () => {
      // Whale opens Trove with 10k ETH
      await borrowerOperations.openTrove(
        th._100pct,
        await getOpenTroveLUSDAmount(dec(10000, 18)),
        whale,
        whale,
        DEFAULT_PRICE_FEED_DATA,
        { from: whale, value: dec(10000, "ether") }
      );

      await borrowerOperations.openTrove(th._100pct, dec(10000, 18), A, A, DEFAULT_PRICE_FEED_DATA, {
        from: A,
        value: dec(200, "ether")
      });
      await borrowerOperations.openTrove(th._100pct, dec(20000, 18), B, B, DEFAULT_PRICE_FEED_DATA, {
        from: B,
        value: dec(300, "ether")
      });
      await borrowerOperations.openTrove(th._100pct, dec(30000, 18), C, C, DEFAULT_PRICE_FEED_DATA, {
        from: C,
        value: dec(400, "ether")
      });
      await borrowerOperations.openTrove(th._100pct, dec(30000, 18), D, D, DEFAULT_PRICE_FEED_DATA, {
        from: D,
        value: dec(400, "ether")
      });

      // Check all LQTY balances are initially 0
      assert.equal(await lqtyToken.balanceOf(A), 0);
      assert.equal(await lqtyToken.balanceOf(B), 0);
      assert.equal(await lqtyToken.balanceOf(C), 0);

      // A, B, C deposit
      await stabilityPool.provideToSP(dec(10000, 18), ZERO_ADDRESS, { from: A });
      await stabilityPool.provideToSP(dec(20000, 18), ZERO_ADDRESS, { from: B });
      await stabilityPool.provideToSP(dec(30000, 18), ZERO_ADDRESS, { from: C });

      // total deposits 60000
      // D deposits. Withdraws immediately after
      assert.equal(await lqtyToken.balanceOf(D), 0);
      await stabilityPool.provideToSP(dec(30000, 18), ZERO_ADDRESS, { from: D });
      await stabilityPool.withdrawFromSP(dec(30000, 18), DEFAULT_PRICE_FEED_DATA, { from: D });
      const D_balance_1block = await lqtyToken.balanceOf(D);

      // Expected gains for each depositor after 1 block
      const D_expectedLQTYGain_1block = REWARDS_PER_BLOCK.div(toBN("3")); // 30% of total rewards in block
      assert.isAtMost(getDifference(D_balance_1block, D_expectedLQTYGain_1block), 1e12);

      // // Expected A gains for each depositor after 5 blocks
      const A_expectedLQTYGain_5blocks = REWARDS_PER_BLOCK.add(REWARDS_PER_BLOCK.div(toBN("3"))) // block 1,2
        .add(REWARDS_PER_BLOCK.div(toBN("6"))) // block 3
        .add(REWARDS_PER_BLOCK.div(toBN("9"))) // block 4
        .add(REWARDS_PER_BLOCK.div(toBN("6"))); // block 5

      await stabilityPool.withdrawFromSP(dec(10000, 18), DEFAULT_PRICE_FEED_DATA, { from: A });
      const A_balance_5block = await lqtyToken.balanceOf(A);
      assert.isAtMost(getDifference(A_balance_5block, A_expectedLQTYGain_5blocks), 1e12);

      await stabilityPool.provideToSP(dec(25000, 18), ZERO_ADDRESS, { from: D });
      await stabilityPool.withdrawFromSP(dec(25000, 18), DEFAULT_PRICE_FEED_DATA, { from: D });

      const D_balance_1block_new = await lqtyToken.balanceOf(D);

      // Expected gains for each depositor after 1 block
      const D_expectedLQTYGain_1block_new = REWARDS_PER_BLOCK.div(toBN("3")).add(
        D_expectedLQTYGain_1block
      ); // 30% of total rewards in block
      assert.isAtMost(getDifference(D_balance_1block_new, D_expectedLQTYGain_1block_new), 1e12);
    });

    // A, B, C deposit. Varied stake. 1 Liquidation. D joins.
    it("withdrawFromSP(): Depositors with varying initial deposit withdraw correct LQTY gain. No liquidations. No front end.", async () => {
      // Whale opens Trove with 10k ETH
      await borrowerOperations.openTrove(
        th._100pct,
        dec(10000, 18),
        whale,
        whale,
        DEFAULT_PRICE_FEED_DATA,
        {
          from: whale,
          value: dec(10000, "ether")
        }
      );

      await borrowerOperations.openTrove(th._100pct, dec(10000, 18), A, A, DEFAULT_PRICE_FEED_DATA, {
        from: A,
        value: dec(200, "ether")
      });
      await borrowerOperations.openTrove(th._100pct, dec(20000, 18), B, B, DEFAULT_PRICE_FEED_DATA, {
        from: B,
        value: dec(300, "ether")
      });
      await borrowerOperations.openTrove(th._100pct, dec(30000, 18), C, C, DEFAULT_PRICE_FEED_DATA, {
        from: C,
        value: dec(400, "ether")
      });
      await borrowerOperations.openTrove(th._100pct, dec(40000, 18), D, D, DEFAULT_PRICE_FEED_DATA, {
        from: D,
        value: dec(500, "ether")
      });
      await borrowerOperations.openTrove(th._100pct, dec(40000, 18), E, E, DEFAULT_PRICE_FEED_DATA, {
        from: E,
        value: dec(600, "ether")
      });

      await borrowerOperations.openTrove(
        th._100pct,
        await getOpenTroveLUSDAmount(dec(30000, 18)),
        defaulter_1,
        defaulter_1,
        DEFAULT_PRICE_FEED_DATA,
        { from: defaulter_1, value: dec(300, "ether") }
      );

      // Check all LQTY balances are initially 0
      assert.equal(await lqtyToken.balanceOf(A), 0);
      assert.equal(await lqtyToken.balanceOf(B), 0);
      assert.equal(await lqtyToken.balanceOf(C), 0);
      assert.equal(await lqtyToken.balanceOf(D), 0);

      // A, B, C deposit
      await stabilityPool.provideToSP(dec(10000, 18), ZERO_ADDRESS, { from: A });
      await stabilityPool.provideToSP(dec(20000, 18), ZERO_ADDRESS, { from: B });
      await stabilityPool.provideToSP(dec(30000, 18), ZERO_ADDRESS, { from: C });

      assert.equal(await stabilityPool.getTotalLUSDDeposits(), dec(60000, 18));

      // Price Drops, defaulter1 liquidated. Stability Pool size drops by 50%
      await priceFeed.setPrice(dec(100, 18));
      assert.isFalse(await th.checkRecoveryMode(contracts));
      await troveManager.liquidate(defaulter_1, DEFAULT_PRICE_FEED_DATA);
      assert.isFalse(await sortedTroves.contains(defaulter_1));

      // Confirm SP dropped from 60k to 30k
      assert.isAtMost(
        getDifference(await stabilityPool.getTotalLUSDDeposits(), dec(30000, 18)),
        1000
      );

      const A_expectedLQTYGain_Y1 = REWARDS_PER_BLOCK.add(REWARDS_PER_BLOCK.div(toBN("3")))
        .add(REWARDS_PER_BLOCK.div(toBN("6")))
        .add(REWARDS_PER_BLOCK.div(toBN("6")))
        .add(REWARDS_PER_BLOCK.div(toBN("6")));

      await stabilityPool.withdrawFromSP(dec(10000, 18), DEFAULT_PRICE_FEED_DATA, { from: A });
      const A_LQTYGain_Y1 = await lqtyToken.balanceOf(A);

      assert.isAtMost(getDifference(A_LQTYGain_Y1, A_expectedLQTYGain_Y1), 1e12);
    });

    //--- Serial pool-emptying liquidations ---

    // --- Scale factor changes ---

    /* Serial scale changes

    A make deposit 10k LUSD
    1 month passes. L1 decreases P: P = 1e-5 P. L1:   9999.9 LUSD, 100 ETH
    B makes deposit 9999.9
    1 month passes. L2 decreases P: P =  1e-5 P. L2:  9999.9 LUSD, 100 ETH
    C makes deposit  9999.9
    1 month passes. L3 decreases P: P = 1e-5 P. L3:  9999.9 LUSD, 100 ETH
    D makes deposit  9999.9
    1 month passes. L4 decreases P: P = 1e-5 P. L4:  9999.9 LUSD, 100 ETH
    E makes deposit  9999.9
    1 month passes. L5 decreases P: P = 1e-5 P. L5:  9999.9 LUSD, 100 ETH
    =========
    F makes deposit 100
    1 month passes. L6 empties the Pool. L6:  10000 LUSD, 100 ETH

    expect A, B, C, D each withdraw ~1 month's worth of LQTY */
    it("withdrawFromSP(): Several deposits of 100 LUSD span one scale factor change. Depositors withdraw correct LQTY gains", async () => {
      // Whale opens Trove with 100 ETH
      await borrowerOperations.openTrove(
        th._100pct,
        await getOpenTroveLUSDAmount(dec(10000, 18)),
        whale,
        whale,
        DEFAULT_PRICE_FEED_DATA,
        { from: whale, value: dec(100, "ether") }
      );

      const fiveDefaulters = [defaulter_1, defaulter_2, defaulter_3, defaulter_4, defaulter_5];

      await borrowerOperations.openTrove(
        th._100pct,
        dec(10000, 18),
        ZERO_ADDRESS,
        ZERO_ADDRESS,
        DEFAULT_PRICE_FEED_DATA,
        {
          from: A,
          value: dec(10000, "ether")
        }
      );
      await borrowerOperations.openTrove(
        th._100pct,
        dec(10000, 18),
        ZERO_ADDRESS,
        ZERO_ADDRESS,
        DEFAULT_PRICE_FEED_DATA,
        {
          from: B,
          value: dec(10000, "ether")
        }
      );
      await borrowerOperations.openTrove(
        th._100pct,
        dec(10000, 18),
        ZERO_ADDRESS,
        ZERO_ADDRESS,
        DEFAULT_PRICE_FEED_DATA,
        {
          from: C,
          value: dec(10000, "ether")
        }
      );
      await borrowerOperations.openTrove(
        th._100pct,
        dec(10000, 18),
        ZERO_ADDRESS,
        ZERO_ADDRESS,
        DEFAULT_PRICE_FEED_DATA,
        {
          from: D,
          value: dec(10000, "ether")
        }
      );
      await borrowerOperations.openTrove(
        th._100pct,
        dec(10000, 18),
        ZERO_ADDRESS,
        ZERO_ADDRESS,
        DEFAULT_PRICE_FEED_DATA,
        {
          from: E,
          value: dec(10000, "ether")
        }
      );
      await borrowerOperations.openTrove(
        th._100pct,
        dec(10000, 18),
        ZERO_ADDRESS,
        ZERO_ADDRESS,
        DEFAULT_PRICE_FEED_DATA,
        {
          from: F,
          value: dec(10000, "ether")
        }
      );

      for (const defaulter of fiveDefaulters) {
        // Defaulters 1-5 each withdraw to 9999.9 debt (including gas comp)
        await borrowerOperations.openTrove(
          th._100pct,
          await getOpenTroveLUSDAmount("9999900000000000000000"),
          defaulter,
          defaulter,
          DEFAULT_PRICE_FEED_DATA,
          { from: defaulter, value: dec(100, "ether") }
        );
      }

      // Defaulter 6 withdraws to 10k debt (inc. gas comp)
      await borrowerOperations.openTrove(
        th._100pct,
        await getOpenTroveLUSDAmount(dec(10000, 18)),
        defaulter_6,
        defaulter_6,
        DEFAULT_PRICE_FEED_DATA,
        { from: defaulter_6, value: dec(100, "ether") }
      );

      // Confirm all depositors have 0 LQTY
      for (const depositor of [A, B, C, D, E, F]) {
        assert.equal(await lqtyToken.balanceOf(depositor), "0");
      }
      // price drops by 50%
      await priceFeed.setPrice(dec(100, 18));

      // Check scale is 0
      // assert.equal(await stabilityPool.currentScale(), '0')

      // A provides to SP
      await stabilityPool.provideToSP(dec(10000, 18), ZERO_ADDRESS, { from: A });

      // Defaulter 1 liquidated.  Value of P updated to  to 1e-5
      const txL1 = await troveManager.liquidate(defaulter_1, DEFAULT_PRICE_FEED_DATA, {
        from: owner
      });
      assert.isFalse(await sortedTroves.contains(defaulter_1));
      assert.isTrue(txL1.receipt.status);

      // Check scale is 0
      assert.equal(await stabilityPool.currentScale(), "0");
      assert.equal(await stabilityPool.P(), dec(1, 13)); //P decreases: P = 1e(18-5) = 1e13

      // B provides to SP
      await stabilityPool.provideToSP(dec(99999, 17), ZERO_ADDRESS, { from: B });

      // 1 month passes
      await th.fastForwardTime(timeValues.SECONDS_IN_ONE_MONTH, web3.currentProvider);

      // Defaulter 2 liquidated
      const txL2 = await troveManager.liquidate(defaulter_2, DEFAULT_PRICE_FEED_DATA, {
        from: owner
      });
      assert.isFalse(await sortedTroves.contains(defaulter_2));
      assert.isTrue(txL2.receipt.status);

      // Check scale is 1
      assert.equal(await stabilityPool.currentScale(), "1");
      assert.equal(await stabilityPool.P(), dec(1, 17)); //Scale changes and P changes: P = 1e(13-5+9) = 1e17

      // C provides to SP
      await stabilityPool.provideToSP(dec(99999, 17), ZERO_ADDRESS, { from: C });

      // 1 month passes
      await th.fastForwardTime(timeValues.SECONDS_IN_ONE_MONTH, web3.currentProvider);

      // Defaulter 3 liquidated
      const txL3 = await troveManager.liquidate(defaulter_3, DEFAULT_PRICE_FEED_DATA, {
        from: owner
      });
      assert.isFalse(await sortedTroves.contains(defaulter_3));
      assert.isTrue(txL3.receipt.status);

      // Check scale is 1
      assert.equal(await stabilityPool.currentScale(), "1");
      assert.equal(await stabilityPool.P(), dec(1, 12)); //P decreases: P 1e(17-5) = 1e12

      // D provides to SP
      await stabilityPool.provideToSP(dec(99999, 17), ZERO_ADDRESS, { from: D });

      // 1 month passes
      await th.fastForwardTime(timeValues.SECONDS_IN_ONE_MONTH, web3.currentProvider);

      // Defaulter 4 liquidated
      const txL4 = await troveManager.liquidate(defaulter_4, DEFAULT_PRICE_FEED_DATA, {
        from: owner
      });
      assert.isFalse(await sortedTroves.contains(defaulter_4));
      assert.isTrue(txL4.receipt.status);

      // Check scale is 2
      assert.equal(await stabilityPool.currentScale(), "2");
      assert.equal(await stabilityPool.P(), dec(1, 16)); //Scale changes and P changes:: P = 1e(12-5+9) = 1e16

      // E provides to SP
      await stabilityPool.provideToSP(dec(99999, 17), ZERO_ADDRESS, { from: E });

      // Defaulter 5 liquidated
      const txL5 = await troveManager.liquidate(defaulter_5, DEFAULT_PRICE_FEED_DATA, {
        from: owner
      });
      assert.isFalse(await sortedTroves.contains(defaulter_5));
      assert.isTrue(txL5.receipt.status);

      // Check scale is 2
      assert.equal(await stabilityPool.currentScale(), "2");
      assert.equal(await stabilityPool.P(), dec(1, 11)); // P decreases: P = 1e(16-5) = 1e11

      // F provides to SP
      await stabilityPool.provideToSP(dec(99999, 17), ZERO_ADDRESS, { from: F });

      assert.equal(await stabilityPool.currentEpoch(), "0");

      // Defaulter 6 liquidated
      const txL6 = await troveManager.liquidate(defaulter_6, DEFAULT_PRICE_FEED_DATA, {
        from: owner
      });
      assert.isFalse(await sortedTroves.contains(defaulter_6));
      assert.isTrue(txL6.receipt.status);

      // Check scale is 0, epoch is 1
      assert.equal(await stabilityPool.currentScale(), "0");
      assert.equal(await stabilityPool.currentEpoch(), "1");
      assert.equal(await stabilityPool.P(), dec(1, 18)); // P resets to 1e18 after pool-emptying
    });

    // --- FrontEnds and kickback rates

    // Simple case: 4 depositors, equal stake. No liquidations.
    it("withdrawFromSP(): Depositors with equal initial deposit withdraw correct LQTY gain. No liquidations. Front ends and kickback rates.", async () => {
      // Register 2 front ends
      const kickbackRate_F1 = toBN(dec(5, 17)); // F1 kicks 50% back to depositor
      const kickbackRate_F2 = toBN(dec(80, 16)); // F2 kicks 80% back to depositor

      await stabilityPool.registerFrontEnd(kickbackRate_F1, { from: frontEnd_1 });
      await stabilityPool.registerFrontEnd(kickbackRate_F2, { from: frontEnd_2 });

      // Whale opens Trove with 10k ETH
      await borrowerOperations.openTrove(
        th._100pct,
        dec(10000, 18),
        whale,
        whale,
        DEFAULT_PRICE_FEED_DATA,
        {
          from: whale,
          value: dec(10000, "ether")
        }
      );

      await borrowerOperations.openTrove(th._100pct, dec(10000, 18), A, A, DEFAULT_PRICE_FEED_DATA, {
        from: A,
        value: dec(100, "ether")
      });
      await borrowerOperations.openTrove(th._100pct, dec(10000, 18), B, B, DEFAULT_PRICE_FEED_DATA, {
        from: B,
        value: dec(100, "ether")
      });
      await borrowerOperations.openTrove(th._100pct, dec(10000, 18), C, C, DEFAULT_PRICE_FEED_DATA, {
        from: C,
        value: dec(100, "ether")
      });
      await borrowerOperations.openTrove(th._100pct, dec(10000, 18), D, D, DEFAULT_PRICE_FEED_DATA, {
        from: D,
        value: dec(100, "ether")
      });
      await borrowerOperations.openTrove(th._100pct, dec(10000, 18), E, E, DEFAULT_PRICE_FEED_DATA, {
        from: E,
        value: dec(100, "ether")
      });

      // Check all LQTY balances are initially 0
      assert.equal(await lqtyToken.balanceOf(A), 0);
      assert.equal(await lqtyToken.balanceOf(B), 0);
      assert.equal(await lqtyToken.balanceOf(C), 0);
      assert.equal(await lqtyToken.balanceOf(D), 0);
      assert.equal(await lqtyToken.balanceOf(frontEnd_1), 0);
      assert.equal(await lqtyToken.balanceOf(frontEnd_2), 0);

      // A, B, C, D deposit
      await stabilityPool.provideToSP(dec(10000, 18), frontEnd_1, { from: A });
      await stabilityPool.provideToSP(dec(10000, 18), frontEnd_2, { from: B });
      await stabilityPool.provideToSP(dec(10000, 18), frontEnd_2, { from: C });
      await stabilityPool.provideToSP(dec(10000, 18), ZERO_ADDRESS, { from: D });

      // Check initial frontEnd stakes are correct:
      let F1_stake = await stabilityPool.frontEndStakes(frontEnd_1);
      let F2_stake = await stabilityPool.frontEndStakes(frontEnd_2);

      assert.equal(F1_stake.totalDeposits, dec(10000, 18));
      assert.equal(F2_stake.totalDeposits, dec(20000, 18));

      // // E deposits, triggering LQTY gains for A,B,C,D,F1,F2. Withdraws immediately after
      // await stabilityPool.provideToSP(dec(1, 18), ZERO_ADDRESS, { from: E });
      // await stabilityPool.withdrawFromSP(dec(1, 18), { from: E });

      // Get actual LQTY gains
      // const A_LQTYGain_Y1 = await stabilityPool.getDepositorLQTYGain(A);
      // const B_LQTYGain_Y1 = await stabilityPool.getDepositorLQTYGain(B);
      // const C_LQTYGain_Y1 = await stabilityPool.getDepositorLQTYGain(C);
      // const D_LQTYGain_Y1 = await stabilityPool.getDepositorLQTYGain(D);
      // const F1_LQTYGain_Y1 = await stabilityPool.getFrontEndLQTYGain(frontEnd_1);
      // const F2_LQTYGain_Y1 = await stabilityPool.getFrontEndLQTYGain(frontEnd_2);

      // Expected depositor and front-end gains
      const A_expectedGain_Y1 = kickbackRate_F1
        .mul(
          REWARDS_PER_BLOCK.add(REWARDS_PER_BLOCK.div(toBN("2")))
            .add(REWARDS_PER_BLOCK.div(toBN("3")))
            .add(REWARDS_PER_BLOCK.div(toBN("4")))
        )
        .div(toBN(1e18));

      await stabilityPool.withdrawFromSP(dec(10000, 18), DEFAULT_PRICE_FEED_DATA, { from: A });
      assert.isAtMost(getDifference(await lqtyToken.balanceOf(A), A_expectedGain_Y1), 1e12);
      // Balance of FE1 = balance A expected when first harvest
      assert.isAtMost(getDifference(await lqtyToken.balanceOf(frontEnd_1), A_expectedGain_Y1), 1e12);

      const B_expectedGain_Y1 = kickbackRate_F2
        .mul(
          REWARDS_PER_BLOCK.div(toBN("2"))
            .add(REWARDS_PER_BLOCK.div(toBN("3")))
            .add(REWARDS_PER_BLOCK.div(toBN("4")))
            .add(REWARDS_PER_BLOCK.div(toBN("3")))
        )
        .div(toBN(1e18));
      await stabilityPool.withdrawFromSP(dec(10000, 18), DEFAULT_PRICE_FEED_DATA, { from: B });
      assert.isAtMost(getDifference(await lqtyToken.balanceOf(B), B_expectedGain_Y1), 1e12);
      const C_expectedGain_Y1 = kickbackRate_F2
        .mul(
          REWARDS_PER_BLOCK.div(toBN("2"))
            .add(REWARDS_PER_BLOCK.div(toBN("3")))
            .add(REWARDS_PER_BLOCK.div(toBN("4")))
            .add(REWARDS_PER_BLOCK.div(toBN("3")))
        )
        .div(DECIMAL_PRECISION);
      await stabilityPool.withdrawFromSP(dec(10000, 18), DEFAULT_PRICE_FEED_DATA, { from: C });
      assert.isAtMost(getDifference(await lqtyToken.balanceOf(C), C_expectedGain_Y1), 1e12);
    });

    // Simple case: 4 depositors, equal stake. Liquidations.
    it("withdrawFromSP(): Depositors with equal initial deposit withdraw correct LQTY gain. No liquidations. Front ends and kickback rates.", async () => {
      // Register 2 front ends
      const kickbackRate_F1 = toBN(dec(5, 17)); // F1 kicks 50% back to depositor
      const kickbackRate_F2 = toBN(dec(80, 16)); // F2 kicks 80% back to depositor

      await stabilityPool.registerFrontEnd(kickbackRate_F1, { from: frontEnd_1 });
      await stabilityPool.registerFrontEnd(kickbackRate_F2, { from: frontEnd_2 });

      // Whale opens Trove with 10k ETH
      await borrowerOperations.openTrove(
        th._100pct,
        dec(10000, 18),
        whale,
        whale,
        DEFAULT_PRICE_FEED_DATA,
        {
          from: whale,
          value: dec(10000, "ether")
        }
      );

      await borrowerOperations.openTrove(th._100pct, dec(20000, 18), A, A, DEFAULT_PRICE_FEED_DATA, {
        from: A,
        value: dec(300, "ether")
      });
      await borrowerOperations.openTrove(th._100pct, dec(20000, 18), B, B, DEFAULT_PRICE_FEED_DATA, {
        from: B,
        value: dec(300, "ether")
      });
      await borrowerOperations.openTrove(th._100pct, dec(20000, 18), C, C, DEFAULT_PRICE_FEED_DATA, {
        from: C,
        value: dec(300, "ether")
      });
      await borrowerOperations.openTrove(th._100pct, dec(20000, 18), D, D, DEFAULT_PRICE_FEED_DATA, {
        from: D,
        value: dec(300, "ether")
      });
      await borrowerOperations.openTrove(th._100pct, dec(20000, 18), E, E, DEFAULT_PRICE_FEED_DATA, {
        from: E,
        value: dec(300, "ether")
      });

      await borrowerOperations.openTrove(
        th._100pct,
        await getOpenTroveLUSDAmount(dec(30000, 18)),
        defaulter_1,
        defaulter_1,
        DEFAULT_PRICE_FEED_DATA,
        { from: defaulter_1, value: dec(300, "ether") }
      );

      // Check all LQTY balances are initially 0
      assert.equal(await lqtyToken.balanceOf(A), 0);
      assert.equal(await lqtyToken.balanceOf(B), 0);
      assert.equal(await lqtyToken.balanceOf(C), 0);
      assert.equal(await lqtyToken.balanceOf(D), 0);
      assert.equal(await lqtyToken.balanceOf(frontEnd_1), 0);
      assert.equal(await lqtyToken.balanceOf(frontEnd_2), 0);

      // A, B, C, D deposit
      await stabilityPool.provideToSP(dec(20000, 18), frontEnd_1, { from: A });
      await stabilityPool.provideToSP(dec(20000, 18), frontEnd_2, { from: B });
      await stabilityPool.provideToSP(dec(20000, 18), frontEnd_2, { from: C });

      assert.equal(await stabilityPool.getTotalLUSDDeposits(), dec(60000, 18));

      // Price Drops, defaulter1 liquidated. Stability Pool size drops by 50%
      await priceFeed.setPrice(dec(100, 18));
      assert.isFalse(await th.checkRecoveryMode(contracts));
      await troveManager.liquidate(defaulter_1, DEFAULT_PRICE_FEED_DATA);
      assert.isFalse(await sortedTroves.contains(defaulter_1));

      // Confirm SP dropped from 60k to 30k
      assert.isAtMost(
        getDifference(await stabilityPool.getTotalLUSDDeposits(), dec(30000, 18)),
        1000
      );

      // Check initial frontEnd stakes are correct:
      let F1_stake = await stabilityPool.frontEndStakes(frontEnd_1);
      let F2_stake = await stabilityPool.frontEndStakes(frontEnd_2);

      assert.equal(F1_stake.totalDeposits, dec(20000, 18));
      assert.equal(F2_stake.totalDeposits, dec(40000, 18));

      // Expected depositor and front-end gains
      const A_expectedGain_Y1 = kickbackRate_F1
        .mul(
          REWARDS_PER_BLOCK.add(REWARDS_PER_BLOCK.div(toBN("2")))
            .add(REWARDS_PER_BLOCK.div(toBN("3")))
            .add(REWARDS_PER_BLOCK.div(toBN("3")))
            .add(REWARDS_PER_BLOCK.div(toBN("3")))
        )
        .div(toBN(1e18));

      await stabilityPool.withdrawFromSP(dec(20000, 18), DEFAULT_PRICE_FEED_DATA, { from: A });
      assert.isAtMost(getDifference(await lqtyToken.balanceOf(A), A_expectedGain_Y1), 1e12);
      // Balance of FE1 = balance A expected when first harvest
      assert.isAtMost(getDifference(await lqtyToken.balanceOf(frontEnd_1), A_expectedGain_Y1), 1e12);

      const B_expectedGain_Y1 = kickbackRate_F2
        .mul(
          REWARDS_PER_BLOCK.div(toBN("2"))
            .add(REWARDS_PER_BLOCK.div(toBN("3")))
            .add(REWARDS_PER_BLOCK.div(toBN("3")))
            .add(REWARDS_PER_BLOCK.div(toBN("3")))
            .add(REWARDS_PER_BLOCK.div(toBN("2")))
        )
        .div(toBN(1e18));
      await stabilityPool.withdrawFromSP(dec(20000, 18), DEFAULT_PRICE_FEED_DATA, { from: B });
      assert.isAtMost(getDifference(await lqtyToken.balanceOf(B), B_expectedGain_Y1), 1e12);
      const C_expectedGain_Y1 = kickbackRate_F2
        .mul(
          REWARDS_PER_BLOCK.div(toBN("3"))
            .add(REWARDS_PER_BLOCK.div(toBN("3")))
            .add(REWARDS_PER_BLOCK.div(toBN("3")))
            .add(REWARDS_PER_BLOCK.div(toBN("2")))
            .add(REWARDS_PER_BLOCK)
        )
        .div(DECIMAL_PRECISION);
      await stabilityPool.withdrawFromSP(dec(20000, 18), DEFAULT_PRICE_FEED_DATA, { from: C });
      assert.isAtMost(getDifference(await lqtyToken.balanceOf(C), C_expectedGain_Y1), 1e12);
    });

    // A, B, C, D deposit 10k,20k,30k,40k.
    // F1: A
    // F2: B, C
    // D makes a naked deposit (no front end)
    // Pool size: 100k
    // 1 month passes. 1st liquidation: 500. All deposits reduced by 500/1000 = 50%.  A:5000,   B:10000, C:15000,   D:20000
    // Pool size: 50k
    // E deposits 30k via F1                                                          A:5000,   B:10000, C:15000,   D:20000, E:30000
    // Pool size: 80k
    // 1 month passes. 2nd liquidation: 20k. All deposits reduced by 200/800 = 25%    A:3750, B:7500,  C:11250, D:15000, E:22500
    // Pool size: 60k
    // B tops up 40k                                                                  A:3750, B:47500, C:11250, D:1500, E:22500
    // Pool size: 100k
    // 1 month passes. 3rd liquidation: 10k. All deposits reduced by 10%.             A:3375, B:42750, C:10125, D:13500, E:20250
    // Pool size 90k
    // C withdraws 10k                                                                A:3375, B:42750, C:125, D:13500, E:20250
    // Pool size 80k
    // 1 month passes.
    // All withdraw
    it("withdrawFromSP(): Depositors with varying initial deposit withdraw correct LQTY gain. Front ends and kickback rates", async () => {
      // Register 2 front ends
      const F1_kickbackRate = toBN(dec(5, 17)); // F1 kicks 50% back to depositor
      const F2_kickbackRate = toBN(dec(80, 16)); // F2 kicks 80% back to depositor

      await stabilityPool.registerFrontEnd(F1_kickbackRate, { from: frontEnd_1 });
      await stabilityPool.registerFrontEnd(F2_kickbackRate, { from: frontEnd_2 });

      // Whale opens Trove with 10k ETH
      await borrowerOperations.openTrove(
        th._100pct,
        dec(10000, 18),
        whale,
        whale,
        DEFAULT_PRICE_FEED_DATA,
        {
          from: whale,
          value: dec(10000, "ether")
        }
      );

      await borrowerOperations.openTrove(th._100pct, dec(10000, 18), A, A, DEFAULT_PRICE_FEED_DATA, {
        from: A,
        value: dec(200, "ether")
      });
      await borrowerOperations.openTrove(th._100pct, dec(60000, 18), B, B, DEFAULT_PRICE_FEED_DATA, {
        from: B,
        value: dec(800, "ether")
      });
      await borrowerOperations.openTrove(th._100pct, dec(30000, 18), C, C, DEFAULT_PRICE_FEED_DATA, {
        from: C,
        value: dec(400, "ether")
      });
      await borrowerOperations.openTrove(th._100pct, dec(40000, 18), D, D, DEFAULT_PRICE_FEED_DATA, {
        from: D,
        value: dec(500, "ether")
      });

      await borrowerOperations.openTrove(th._100pct, dec(30000, 18), E, E, DEFAULT_PRICE_FEED_DATA, {
        from: E,
        value: dec(400, "ether")
      });

      // D1, D2, D3 open troves with total debt 50k, 30k, 10k respectively (inc. gas comp)
      await borrowerOperations.openTrove(
        th._100pct,
        await getOpenTroveLUSDAmount(dec(50000, 18)),
        defaulter_1,
        defaulter_1,
        DEFAULT_PRICE_FEED_DATA,
        { from: defaulter_1, value: dec(500, "ether") }
      );
      await borrowerOperations.openTrove(
        th._100pct,
        await getOpenTroveLUSDAmount(dec(20000, 18)),
        defaulter_2,
        defaulter_2,
        DEFAULT_PRICE_FEED_DATA,
        { from: defaulter_2, value: dec(200, "ether") }
      );
      await borrowerOperations.openTrove(
        th._100pct,
        await getOpenTroveLUSDAmount(dec(10000, 18)),
        defaulter_3,
        defaulter_3,
        DEFAULT_PRICE_FEED_DATA,
        { from: defaulter_3, value: dec(100, "ether") }
      );

      // Check all LQTY balances are initially 0
      assert.equal(await lqtyToken.balanceOf(A), 0);
      assert.equal(await lqtyToken.balanceOf(B), 0);
      assert.equal(await lqtyToken.balanceOf(C), 0);
      assert.equal(await lqtyToken.balanceOf(D), 0);
      assert.equal(await lqtyToken.balanceOf(frontEnd_1), 0);
      assert.equal(await lqtyToken.balanceOf(frontEnd_2), 0);

      // A, B, C, D deposit
      await stabilityPool.provideToSP(dec(10000, 18), frontEnd_1, { from: A });
      await stabilityPool.provideToSP(dec(20000, 18), frontEnd_2, { from: B });
      await stabilityPool.provideToSP(dec(30000, 18), frontEnd_2, { from: C });
      await stabilityPool.provideToSP(dec(40000, 18), ZERO_ADDRESS, { from: D });

      // Price Drops, defaulters become undercollateralized
      await priceFeed.setPrice(dec(105, 18));
      assert.isFalse(await th.checkRecoveryMode(contracts));

      // Check initial frontEnd stakes are correct:
      let F1_stake = await stabilityPool.frontEndStakes(frontEnd_1);
      let F2_stake = await stabilityPool.frontEndStakes(frontEnd_2);

      assert.equal(F1_stake.totalDeposits, dec(10000, 18));
      assert.equal(F2_stake.totalDeposits, dec(50000, 18));

      assert.equal(await stabilityPool.getTotalLUSDDeposits(), dec(100000, 18)); // total 100k

      // LIQUIDATION 1
      await troveManager.liquidate(defaulter_1, DEFAULT_PRICE_FEED_DATA);
      assert.isFalse(await sortedTroves.contains(defaulter_1));

      th.assertIsApproximatelyEqual(await stabilityPool.getTotalLUSDDeposits(), dec(50000, 18)); // 50k

      // --- CHECK GAINS AFTER L1 ---

      // During month 1, deposit sizes are: A:10000, B:20000, C:30000, D:40000.  Total: 100000
      // // Expected gains for each depositor after month 1
      // const A_share_M1 = issuance_M1.mul(toBN("10000")).div(toBN("100000"));
      // const A_expectedLQTYGain_M1 = F1_kickbackRate.mul(A_share_M1).div(toBN(dec(1, 18)));

      // const B_share_M1 = issuance_M1.mul(toBN("20000")).div(toBN("100000"));
      // const B_expectedLQTYGain_M1 = F2_kickbackRate.mul(B_share_M1).div(toBN(dec(1, 18)));

      // const C_share_M1 = issuance_M1.mul(toBN("30000")).div(toBN("100000"));
      // const C_expectedLQTYGain_M1 = F2_kickbackRate.mul(C_share_M1).div(toBN(dec(1, 18)));

      // const D_share_M1 = issuance_M1.mul(toBN("40000")).div(toBN("100000"));
      // const D_expectedLQTYGain_M1 = D_share_M1;

      // // F1's stake = A
      // const F1_expectedLQTYGain_M1 = toBN(dec(1, 18))
      //   .sub(F1_kickbackRate)
      //   .mul(A_share_M1)
      //   .div(toBN(dec(1, 18)));

      // // F2's stake = B + C
      // const F2_expectedLQTYGain_M1 = toBN(dec(1, 18))
      //   .sub(F2_kickbackRate)
      //   .mul(B_share_M1.add(C_share_M1))
      //   .div(toBN(dec(1, 18)));

      // // Check LQTY gain
      // const A_LQTYGain_M1 = await stabilityPool.getDepositorLQTYGain(A);
      // const B_LQTYGain_M1 = await stabilityPool.getDepositorLQTYGain(B);
      // const C_LQTYGain_M1 = await stabilityPool.getDepositorLQTYGain(C);
      // const D_LQTYGain_M1 = await stabilityPool.getDepositorLQTYGain(D);
      // const F1_LQTYGain_M1 = await stabilityPool.getFrontEndLQTYGain(frontEnd_1);
      // const F2_LQTYGain_M1 = await stabilityPool.getFrontEndLQTYGain(frontEnd_2);

      // // Check gains are correct, error tolerance = 1e-3 of a token
      // assert.isAtMost(getDifference(A_LQTYGain_M1, A_expectedLQTYGain_M1), 1e15);
      // assert.isAtMost(getDifference(B_LQTYGain_M1, B_expectedLQTYGain_M1), 1e15);
      // assert.isAtMost(getDifference(C_LQTYGain_M1, C_expectedLQTYGain_M1), 1e15);
      // assert.isAtMost(getDifference(D_LQTYGain_M1, D_expectedLQTYGain_M1), 1e15);
      // assert.isAtMost(getDifference(F1_LQTYGain_M1, F1_expectedLQTYGain_M1), 1e15);
      // assert.isAtMost(getDifference(F2_LQTYGain_M1, F2_expectedLQTYGain_M1), 1e15);

      // // E deposits 30k via F1
      // await stabilityPool.provideToSP(dec(30000, 18), frontEnd_1, { from: E });

      // th.assertIsApproximatelyEqual(await stabilityPool.getTotalLUSDDeposits(), dec(80000, 18));

      // // Month 2 passes
      // await th.fastForwardTime(timeValues.SECONDS_IN_ONE_MONTH, web3.currentProvider);

      // // LIQUIDATION 2
      // await troveManager.liquidate(defaulter_2);
      // assert.isFalse(await sortedTroves.contains(defaulter_2));

      // th.assertIsApproximatelyEqual(await stabilityPool.getTotalLUSDDeposits(), dec(60000, 18));

      // const startTime = await communityIssuanceTester.deploymentTime();
      // const currentTime = await th.getLatestBlockTimestamp(web3);
      // const timePassed = toBN(currentTime).sub(startTime);

      // // --- CHECK GAINS AFTER L2 ---

      // // During month 2, deposit sizes:  A:5000,   B:10000, C:15000,  D:20000, E:30000. Total: 80000

      // // Expected gains for each depositor after month 2
      // const A_share_M2 = issuance_M2.mul(toBN("5000")).div(toBN("80000"));
      // const A_expectedLQTYGain_M2 = F1_kickbackRate.mul(A_share_M2).div(toBN(dec(1, 18)));

      // const B_share_M2 = issuance_M2.mul(toBN("10000")).div(toBN("80000"));
      // const B_expectedLQTYGain_M2 = F2_kickbackRate.mul(B_share_M2).div(toBN(dec(1, 18)));

      // const C_share_M2 = issuance_M2.mul(toBN("15000")).div(toBN("80000"));
      // const C_expectedLQTYGain_M2 = F2_kickbackRate.mul(C_share_M2).div(toBN(dec(1, 18)));

      // const D_share_M2 = issuance_M2.mul(toBN("20000")).div(toBN("80000"));
      // const D_expectedLQTYGain_M2 = D_share_M2;

      // const E_share_M2 = issuance_M2.mul(toBN("30000")).div(toBN("80000"));
      // const E_expectedLQTYGain_M2 = F1_kickbackRate.mul(E_share_M2).div(toBN(dec(1, 18)));

      // // F1's stake = A + E
      // const F1_expectedLQTYGain_M2 = toBN(dec(1, 18))
      //   .sub(F1_kickbackRate)
      //   .mul(A_share_M2.add(E_share_M2))
      //   .div(toBN(dec(1, 18)));

      // // F2's stake = B + C
      // const F2_expectedLQTYGain_M2 = toBN(dec(1, 18))
      //   .sub(F2_kickbackRate)
      //   .mul(B_share_M2.add(C_share_M2))
      //   .div(toBN(dec(1, 18)));

      // // Check LQTY gains after month 2
      // const A_LQTYGain_After_M2 = await stabilityPool.getDepositorLQTYGain(A);
      // const B_LQTYGain_After_M2 = await stabilityPool.getDepositorLQTYGain(B);
      // const C_LQTYGain_After_M2 = await stabilityPool.getDepositorLQTYGain(C);
      // const D_LQTYGain_After_M2 = await stabilityPool.getDepositorLQTYGain(D);
      // const E_LQTYGain_After_M2 = await stabilityPool.getDepositorLQTYGain(E);
      // const F1_LQTYGain_After_M2 = await stabilityPool.getFrontEndLQTYGain(frontEnd_1);
      // const F2_LQTYGain_After_M2 = await stabilityPool.getFrontEndLQTYGain(frontEnd_2);

      // assert.isAtMost(
      //   getDifference(A_LQTYGain_After_M2, A_expectedLQTYGain_M2.add(A_expectedLQTYGain_M1)),
      //   1e15
      // );
      // assert.isAtMost(
      //   getDifference(B_LQTYGain_After_M2, B_expectedLQTYGain_M2.add(B_expectedLQTYGain_M1)),
      //   1e15
      // );
      // assert.isAtMost(
      //   getDifference(C_LQTYGain_After_M2, C_expectedLQTYGain_M2.add(C_expectedLQTYGain_M1)),
      //   1e15
      // );
      // assert.isAtMost(
      //   getDifference(D_LQTYGain_After_M2, D_expectedLQTYGain_M2.add(D_expectedLQTYGain_M1)),
      //   1e15
      // );
      // assert.isAtMost(getDifference(E_LQTYGain_After_M2, E_expectedLQTYGain_M2), 1e15);

      // // Check F1 balance is his M1 gain (it was paid out when E joined through F1)
      // const F1_LQTYBalance_After_M2 = await lqtyToken.balanceOf(frontEnd_1);
      // assert.isAtMost(getDifference(F1_LQTYBalance_After_M2, F1_expectedLQTYGain_M1), 1e15);

      // // Check F1's LQTY gain in system after M2: Just their gain due to M2
      // assert.isAtMost(getDifference(F1_LQTYGain_After_M2, F1_expectedLQTYGain_M2), 1e15);

      // // Check F2 LQTY gain in system after M2: the sum of their gains from M1 + M2
      // assert.isAtMost(
      //   getDifference(F2_LQTYGain_After_M2, F2_expectedLQTYGain_M2.add(F2_expectedLQTYGain_M1)),
      //   1e15
      // );

      // // B tops up 40k via F2
      // await stabilityPool.provideToSP(dec(40000, 18), frontEnd_2, { from: B });

      // th.assertIsApproximatelyEqual(await stabilityPool.getTotalLUSDDeposits(), dec(100000, 18));

      // // Month 3 passes
      // await th.fastForwardTime(timeValues.SECONDS_IN_ONE_MONTH, web3.currentProvider);

      // // LIQUIDATION 3
      // await troveManager.liquidate(defaulter_3);
      // assert.isFalse(await sortedTroves.contains(defaulter_3));

      // th.assertIsApproximatelyEqual(await stabilityPool.getTotalLUSDDeposits(), dec(90000, 18));

      // // --- CHECK GAINS AFTER L3 ---

      // // During month 3, deposit sizes: A:3750, B:47500, C:11250, D:15000, E:22500, Total: 100000

      // // Expected gains for each depositor after month 3
      // const A_share_M3 = issuance_M3.mul(toBN("3750")).div(toBN("100000"));
      // const A_expectedLQTYGain_M3 = F1_kickbackRate.mul(A_share_M3).div(toBN(dec(1, 18)));

      // const B_share_M3 = issuance_M3.mul(toBN("47500")).div(toBN("100000"));
      // const B_expectedLQTYGain_M3 = F2_kickbackRate.mul(B_share_M3).div(toBN(dec(1, 18)));

      // const C_share_M3 = issuance_M3.mul(toBN("11250")).div(toBN("100000"));
      // const C_expectedLQTYGain_M3 = F2_kickbackRate.mul(C_share_M3).div(toBN(dec(1, 18)));

      // const D_share_M3 = issuance_M3.mul(toBN("15000")).div(toBN("100000"));
      // const D_expectedLQTYGain_M3 = D_share_M3;

      // const E_share_M3 = issuance_M3.mul(toBN("22500")).div(toBN("100000"));
      // const E_expectedLQTYGain_M3 = F1_kickbackRate.mul(E_share_M3).div(toBN(dec(1, 18)));

      // // F1's stake = A + E
      // const F1_expectedLQTYGain_M3 = toBN(dec(1, 18))
      //   .sub(F1_kickbackRate)
      //   .mul(A_share_M3.add(E_share_M3))
      //   .div(toBN(dec(1, 18)));

      // // F2's stake = B + C
      // const F2_expectedLQTYGain_M3 = toBN(dec(1, 18))
      //   .sub(F2_kickbackRate)
      //   .mul(B_share_M3.add(C_share_M3))
      //   .div(toBN(dec(1, 18)));

      // // Check LQTY gains after month 3
      // const A_LQTYGain_After_M3 = await stabilityPool.getDepositorLQTYGain(A);
      // const B_LQTYGain_After_M3 = await stabilityPool.getDepositorLQTYGain(B);
      // const C_LQTYGain_After_M3 = await stabilityPool.getDepositorLQTYGain(C);
      // const D_LQTYGain_After_M3 = await stabilityPool.getDepositorLQTYGain(D);
      // const E_LQTYGain_After_M3 = await stabilityPool.getDepositorLQTYGain(E);
      // const F1_LQTYGain_After_M3 = await stabilityPool.getFrontEndLQTYGain(frontEnd_1);
      // const F2_LQTYGain_After_M3 = await stabilityPool.getFrontEndLQTYGain(frontEnd_2);

      // // Expect A, C, D LQTY system gains to equal their gains from (M1 + M2 + M3)
      // assert.isAtMost(
      //   getDifference(
      //     A_LQTYGain_After_M3,
      //     A_expectedLQTYGain_M3.add(A_expectedLQTYGain_M2).add(A_expectedLQTYGain_M1)
      //   ),
      //   1e15
      // );
      // assert.isAtMost(
      //   getDifference(
      //     C_LQTYGain_After_M3,
      //     C_expectedLQTYGain_M3.add(C_expectedLQTYGain_M2).add(C_expectedLQTYGain_M1)
      //   ),
      //   1e15
      // );
      // assert.isAtMost(
      //   getDifference(
      //     D_LQTYGain_After_M3,
      //     D_expectedLQTYGain_M3.add(D_expectedLQTYGain_M2).add(D_expectedLQTYGain_M1)
      //   ),
      //   1e15
      // );

      // // Expect E's LQTY system gain to equal their gains from (M2 + M3)
      // assert.isAtMost(
      //   getDifference(E_LQTYGain_After_M3, E_expectedLQTYGain_M3.add(E_expectedLQTYGain_M2)),
      //   1e15
      // );

      // // Expect B LQTY system gains to equal gains just from M3 (his topup paid out his gains from M1 + M2)
      // assert.isAtMost(getDifference(B_LQTYGain_After_M3, B_expectedLQTYGain_M3), 1e15);

      // // Expect B LQTY balance to equal gains from (M1 + M2)
      // const B_LQTYBalance_After_M3 = await await lqtyToken.balanceOf(B);
      // assert.isAtMost(
      //   getDifference(B_LQTYBalance_After_M3, B_expectedLQTYGain_M2.add(B_expectedLQTYGain_M1)),
      //   1e15
      // );

      // // Expect F1 LQTY system gains to equal their gain from (M2 + M3)
      // assert.isAtMost(
      //   getDifference(F1_LQTYGain_After_M3, F1_expectedLQTYGain_M3.add(F1_expectedLQTYGain_M2)),
      //   1e15
      // );

      // // Expect F1 LQTY balance to equal their M1 gain
      // const F1_LQTYBalance_After_M3 = await lqtyToken.balanceOf(frontEnd_1);
      // assert.isAtMost(getDifference(F1_LQTYBalance_After_M3, F1_expectedLQTYGain_M1), 1e15);

      // // Expect F2 LQTY system gains to equal their gain from M3
      // assert.isAtMost(getDifference(F2_LQTYGain_After_M3, F2_expectedLQTYGain_M3), 1e15);

      // // Expect F2 LQTY balance to equal their gain from M1 + M2
      // const F2_LQTYBalance_After_M3 = await lqtyToken.balanceOf(frontEnd_2);
      // assert.isAtMost(
      //   getDifference(F2_LQTYBalance_After_M3, F2_expectedLQTYGain_M2.add(F2_expectedLQTYGain_M1)),
      //   1e15
      // );

      // // Expect deposit C now to be 10125 LUSD
      // const C_compoundedLUSDDeposit = await stabilityPool.getCompoundedLUSDDeposit(C);
      // assert.isAtMost(getDifference(C_compoundedLUSDDeposit, dec(10125, 18)), 1000);

      // // --- C withdraws ---

      // th.assertIsApproximatelyEqual(await stabilityPool.getTotalLUSDDeposits(), dec(90000, 18));

      // await stabilityPool.withdrawFromSP(dec(10000, 18), { from: C });

      // th.assertIsApproximatelyEqual(await stabilityPool.getTotalLUSDDeposits(), dec(80000, 18));

      // // Month 4 passes
      // await th.fastForwardTime(timeValues.SECONDS_IN_ONE_MONTH, web3.currentProvider);

      // // All depositors fully withdraw
      // for (depositor of [A, B, C, D, E]) {
      //   await stabilityPool.withdrawFromSP(dec(100000, 18), { from: depositor });
      //   const compoundedLUSDDeposit = await stabilityPool.getCompoundedLUSDDeposit(depositor);
      //   assert.equal(compoundedLUSDDeposit, "0");
      // }

      // // During month 4, deposit sizes: A:3375, B:42750, C:125, D:13500, E:20250, Total: 80000

      // // Expected gains for each depositor after month 4
      // const A_share_M4 = issuance_M4.mul(toBN("3375")).div(toBN("80000")); // 3375/800
      // const A_expectedLQTYGain_M4 = F1_kickbackRate.mul(A_share_M4).div(toBN(dec(1, 18)));

      // const B_share_M4 = issuance_M4.mul(toBN("42750")).div(toBN("80000")); // 42750/80000
      // const B_expectedLQTYGain_M4 = F2_kickbackRate.mul(B_share_M4).div(toBN(dec(1, 18)));

      // const C_share_M4 = issuance_M4.mul(toBN("125")).div(toBN("80000")); // 125/80000
      // const C_expectedLQTYGain_M4 = F2_kickbackRate.mul(C_share_M4).div(toBN(dec(1, 18)));

      // const D_share_M4 = issuance_M4.mul(toBN("13500")).div(toBN("80000"));
      // const D_expectedLQTYGain_M4 = D_share_M4;

      // const E_share_M4 = issuance_M4.mul(toBN("20250")).div(toBN("80000")); // 2025/80000
      // const E_expectedLQTYGain_M4 = F1_kickbackRate.mul(E_share_M4).div(toBN(dec(1, 18)));

      // // F1's stake = A + E
      // const F1_expectedLQTYGain_M4 = toBN(dec(1, 18))
      //   .sub(F1_kickbackRate)
      //   .mul(A_share_M4.add(E_share_M4))
      //   .div(toBN(dec(1, 18)));

      // // F2's stake = B + C
      // const F2_expectedLQTYGain_M4 = toBN(dec(1, 18))
      //   .sub(F2_kickbackRate)
      //   .mul(B_share_M4.add(C_share_M4))
      //   .div(toBN(dec(1, 18)));

      // // Get final LQTY balances
      // const A_FinalLQTYBalance = await lqtyToken.balanceOf(A);
      // const B_FinalLQTYBalance = await lqtyToken.balanceOf(B);
      // const C_FinalLQTYBalance = await lqtyToken.balanceOf(C);
      // const D_FinalLQTYBalance = await lqtyToken.balanceOf(D);
      // const E_FinalLQTYBalance = await lqtyToken.balanceOf(E);
      // const F1_FinalLQTYBalance = await lqtyToken.balanceOf(frontEnd_1);
      // const F2_FinalLQTYBalance = await lqtyToken.balanceOf(frontEnd_2);

      // const A_expectedFinalLQTYBalance = A_expectedLQTYGain_M1.add(A_expectedLQTYGain_M2)
      //   .add(A_expectedLQTYGain_M3)
      //   .add(A_expectedLQTYGain_M4);

      // const B_expectedFinalLQTYBalance = B_expectedLQTYGain_M1.add(B_expectedLQTYGain_M2)
      //   .add(B_expectedLQTYGain_M3)
      //   .add(B_expectedLQTYGain_M4);

      // const C_expectedFinalLQTYBalance = C_expectedLQTYGain_M1.add(C_expectedLQTYGain_M2)
      //   .add(C_expectedLQTYGain_M3)
      //   .add(C_expectedLQTYGain_M4);

      // const D_expectedFinalLQTYBalance = D_expectedLQTYGain_M1.add(D_expectedLQTYGain_M2)
      //   .add(D_expectedLQTYGain_M3)
      //   .add(D_expectedLQTYGain_M4);

      // const E_expectedFinalLQTYBalance = E_expectedLQTYGain_M2.add(E_expectedLQTYGain_M3).add(
      //   E_expectedLQTYGain_M4
      // );

      // const F1_expectedFinalLQTYBalance = F1_expectedLQTYGain_M1.add(F1_expectedLQTYGain_M2)
      //   .add(F1_expectedLQTYGain_M3)
      //   .add(F1_expectedLQTYGain_M4);

      // const F2_expectedFinalLQTYBalance = F2_expectedLQTYGain_M1.add(F2_expectedLQTYGain_M2)
      //   .add(F2_expectedLQTYGain_M3)
      //   .add(F2_expectedLQTYGain_M4);

      // assert.isAtMost(getDifference(A_FinalLQTYBalance, A_expectedFinalLQTYBalance), 1e15);
      // assert.isAtMost(getDifference(B_FinalLQTYBalance, B_expectedFinalLQTYBalance), 1e15);
      // assert.isAtMost(getDifference(C_FinalLQTYBalance, C_expectedFinalLQTYBalance), 1e15);
      // assert.isAtMost(getDifference(D_FinalLQTYBalance, D_expectedFinalLQTYBalance), 1e15);
      // assert.isAtMost(getDifference(E_FinalLQTYBalance, E_expectedFinalLQTYBalance), 1e15);
      // assert.isAtMost(getDifference(F1_FinalLQTYBalance, F1_expectedFinalLQTYBalance), 1e15);
      // assert.isAtMost(getDifference(F2_FinalLQTYBalance, F2_expectedFinalLQTYBalance), 1e15);
    });

    /* Serial scale changes, with one front end

    F1 kickbackRate: 80%

    A, B make deposit 5000 LUSD via F1
    1 month passes. L1 depletes P: P = 1e-5*P L1:  9999.9 LUSD, 1 ETH.  scale = 0
    C makes deposit 10000  via F1
    1 month passes. L2 depletes P: P = 1e-5*P L2:  9999.9 LUSD, 1 ETH  scale = 1
    D makes deposit 10000 via F1
    1 month passes. L3 depletes P: P = 1e-5*P L3:  9999.9 LUSD, 1 ETH scale = 1
    E makes deposit 10000 via F1
    1 month passes. L3 depletes P: P = 1e-5*P L4:  9999.9 LUSD, 1 ETH scale = 2
    A, B, C, D, E withdraw

    =========
    Expect front end withdraws ~3 month's worth of LQTY */

    it("withdrawFromSP(): Several deposits of 10k LUSD span one scale factor change. Depositors withdraw correct LQTY gains", async () => {
      const kickbackRate = toBN(dec(80, 16)); // F1 kicks 80% back to depositor
      await stabilityPool.registerFrontEnd(kickbackRate, { from: frontEnd_1 });

      // Whale opens Trove with 10k ETH
      await borrowerOperations.openTrove(
        th._100pct,
        dec(10000, 18),
        whale,
        whale,
        DEFAULT_PRICE_FEED_DATA,
        {
          from: whale,
          value: dec(10000, "ether")
        }
      );

      const _4_Defaulters = [defaulter_1, defaulter_2, defaulter_3, defaulter_4];

      for (const defaulter of _4_Defaulters) {
        // Defaulters 1-4 each withdraw to 9999.9 debt (including gas comp)
        await borrowerOperations.openTrove(
          th._100pct,
          await getOpenTroveLUSDAmount(dec(99999, 17)),
          defaulter,
          defaulter,
          DEFAULT_PRICE_FEED_DATA,
          { from: defaulter, value: dec(100, "ether") }
        );
      }

      // Confirm all would-be depositors have 0 LQTY
      for (const depositor of [A, B, C, D, E]) {
        assert.equal(await lqtyToken.balanceOf(depositor), "0");
      }
      assert.equal(await lqtyToken.balanceOf(frontEnd_1), "0");

      // price drops by 50%
      await priceFeed.setPrice(dec(100, 18));

      // Check scale is 0
      assert.equal(await stabilityPool.currentScale(), "0");

      // A, B provides 5000 LUSD to SP
      await borrowerOperations.openTrove(th._100pct, dec(5000, 18), A, A, DEFAULT_PRICE_FEED_DATA, {
        from: A,
        value: dec(200, "ether")
      });
      await stabilityPool.provideToSP(dec(5000, 18), frontEnd_1, { from: A });
      await borrowerOperations.openTrove(th._100pct, dec(5000, 18), B, B, DEFAULT_PRICE_FEED_DATA, {
        from: B,
        value: dec(200, "ether")
      });
      await stabilityPool.provideToSP(dec(5000, 18), frontEnd_1, { from: B });

      // Defaulter 1 liquidated.  Value of P updated to  to 9999999, i.e. in decimal, ~1e-10
      const txL1 = await troveManager.liquidate(defaulter_1, DEFAULT_PRICE_FEED_DATA, {
        from: owner
      });
      assert.isFalse(await sortedTroves.contains(defaulter_1));
      assert.isTrue(txL1.receipt.status);

      // Check scale is 0
      assert.equal(await stabilityPool.currentScale(), "0");

      // C provides to SP
      await borrowerOperations.openTrove(th._100pct, dec(99999, 17), C, C, DEFAULT_PRICE_FEED_DATA, {
        from: C,
        value: dec(200, "ether")
      });
      await stabilityPool.provideToSP(dec(99999, 17), frontEnd_1, { from: C });

      // Defaulter 2 liquidated
      const txL2 = await troveManager.liquidate(defaulter_2, DEFAULT_PRICE_FEED_DATA, {
        from: owner
      });
      assert.isFalse(await sortedTroves.contains(defaulter_2));
      assert.isTrue(txL2.receipt.status);

      // Check scale is 1
      assert.equal(await stabilityPool.currentScale(), "1");

      // D provides to SP
      await borrowerOperations.openTrove(th._100pct, dec(99999, 17), D, D, DEFAULT_PRICE_FEED_DATA, {
        from: D,
        value: dec(200, "ether")
      });
      await stabilityPool.provideToSP(dec(99999, 17), frontEnd_1, { from: D });

      // Defaulter 3 liquidated
      const txL3 = await troveManager.liquidate(defaulter_3, DEFAULT_PRICE_FEED_DATA, {
        from: owner
      });
      assert.isFalse(await sortedTroves.contains(defaulter_3));
      assert.isTrue(txL3.receipt.status);

      // Check scale is 1
      assert.equal(await stabilityPool.currentScale(), "1");

      // E provides to SP
      await borrowerOperations.openTrove(th._100pct, dec(99999, 17), E, E, DEFAULT_PRICE_FEED_DATA, {
        from: E,
        value: dec(200, "ether")
      });
      await stabilityPool.provideToSP(dec(99999, 17), frontEnd_1, { from: E });

      // Defaulter 4 liquidated
      const txL4 = await troveManager.liquidate(defaulter_4, DEFAULT_PRICE_FEED_DATA, {
        from: owner
      });
      assert.isFalse(await sortedTroves.contains(defaulter_4));
      assert.isTrue(txL4.receipt.status);

      // Check scale is 2
      assert.equal(await stabilityPool.currentScale(), "2");

      /* All depositors withdraw fully from SP.  Withdraw in reverse order, so that the largest remaining
      deposit (F) withdraws first, and does not get extra LQTY gains from the periods between withdrawals */
      for (depositor of [E, D, C, B, A]) {
        await stabilityPool.withdrawFromSP(dec(10000, 18), DEFAULT_PRICE_FEED_DATA, {
          from: depositor
        });
      }

      const LQTYGain_A = await lqtyToken.balanceOf(A);
      const LQTYGain_B = await lqtyToken.balanceOf(B);
      const LQTYGain_C = await lqtyToken.balanceOf(C);
      const LQTYGain_D = await lqtyToken.balanceOf(D);
      const LQTYGain_E = await lqtyToken.balanceOf(E);

      const LQTYGain_F1 = await lqtyToken.balanceOf(frontEnd_1);

      /* Expect each deposit to have earned LQTY issuance for the month in which it was active, prior
     to the liquidation that mostly depleted it:
     
     expectedLQTYGain_A:  (k * M1 / 2) + (k * M2 / 2) / 100000   
     expectedLQTYGain_B:  (k * M1 / 2) + (k * M2 / 2) / 100000                           

     expectedLQTYGain_C:  ((k * M2)  + (k * M3) / 100000) * 9999.9/10000   
     expectedLQTYGain_D:  ((k * M3)  + (k * M4) / 100000) * 9999.9/10000 
     expectedLQTYGain_E:  (k * M4) * 9999.9/10000 

     expectedLQTYGain_F1:  (1 - k) * (M1 + M2 + M3 + M4)
     */

      // const expectedLQTYGain_A_and_B = kickbackRate
      //   .mul(issuance_M1)
      //   .div(toBN("2"))
      //   .div(toBN(dec(1, 18))) // gain from L1
      //   .add(
      //     kickbackRate
      //       .mul(issuance_M2)
      //       .div(toBN("2"))
      //       .div(toBN(dec(1, 18)))
      //       .div(toBN("100000"))
      //   ); // gain from L2 after deposit depleted

      // const expectedLQTYGain_C = kickbackRate
      //   .mul(issuance_M2)
      //   .div(toBN(dec(1, 18))) // gain from L2
      //   .add(
      //     kickbackRate
      //       .mul(issuance_M3)
      //       .div(toBN(dec(1, 18)))
      //       .div(toBN("100000")) // gain from L3 after deposit depleted
      //   )
      //   .mul(toBN("99999"))
      //   .div(toBN("100000")); // Scale by 9999.9/10000

      // const expectedLQTYGain_D = kickbackRate
      //   .mul(issuance_M3)
      //   .div(toBN(dec(1, 18))) // gain from L3
      //   .add(
      //     kickbackRate
      //       .mul(issuance_M4)
      //       .div(toBN(dec(1, 18)))
      //       .div(toBN("100000")) // gain from L4
      //   )
      //   .mul(toBN("99999"))
      //   .div(toBN("100000")); // Scale by 9999.9/10000

      // const expectedLQTYGain_E = kickbackRate
      //   .mul(issuance_M4)
      //   .div(toBN(dec(1, 18))) // gain from L4
      //   .mul(toBN("99999"))
      //   .div(toBN("100000")); // Scale by 9999.9/10000

      // const issuance1st4Months = issuance_M1.add(issuance_M2).add(issuance_M3).add(issuance_M4);
      // const expectedLQTYGain_F1 = toBN(dec(1, 18))
      //   .sub(kickbackRate)
      //   .mul(issuance1st4Months)
      //   .div(toBN(dec(1, 18)));

      // assert.isAtMost(getDifference(expectedLQTYGain_A_and_B, LQTYGain_A), 1e15);
      // assert.isAtMost(getDifference(expectedLQTYGain_A_and_B, LQTYGain_B), 1e15);
      // assert.isAtMost(getDifference(expectedLQTYGain_C, LQTYGain_C), 1e15);
      // assert.isAtMost(getDifference(expectedLQTYGain_D, LQTYGain_D), 1e15);
      // assert.isAtMost(getDifference(expectedLQTYGain_E, LQTYGain_E), 1e15);
      // assert.isAtMost(getDifference(expectedLQTYGain_F1, LQTYGain_F1), 1e15);
    });
  });
});

contract("Reset chain state", async accounts => {});
