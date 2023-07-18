const BN = require("bn.js");
const Destructible = artifacts.require("./TestContracts/Destructible.sol");
const { defaultAbiCoder, Interface } = require("@ethersproject/abi");

const PRICE_IDS = [
// You can find the ids of prices at https://pyth.network/developers/price-feed-ids#pyth-evm-testnet
  "0xecf553770d9b10965f8fb64771e93f5690a182edc32be4a3236e0caaa6e0581a", // BNB:USD price id in testnet
];

const MoneyValues = {
  negative_5e17: "-" + web3.utils.toWei("500", "finney"),
  negative_1e18: "-" + web3.utils.toWei("1", "ether"),
  negative_10e18: "-" + web3.utils.toWei("10", "ether"),
  negative_50e18: "-" + web3.utils.toWei("50", "ether"),
  negative_100e18: "-" + web3.utils.toWei("100", "ether"),
  negative_101e18: "-" + web3.utils.toWei("101", "ether"),
  negative_eth: amount => "-" + web3.utils.toWei(amount, "ether"),

  _zeroBN: web3.utils.toBN("0"),
  _1e18BN: web3.utils.toBN("1000000000000000000"),
  _10e18BN: web3.utils.toBN("10000000000000000000"),
  _100e18BN: web3.utils.toBN("100000000000000000000"),
  _100BN: web3.utils.toBN("100"),
  _110BN: web3.utils.toBN("110"),
  _150BN: web3.utils.toBN("150"),

  _MCR: web3.utils.toBN("1100000000000000000"),
  _ICR100: web3.utils.toBN("1000000000000000000"),
  _CCR: web3.utils.toBN("1500000000000000000")
};

const TimeValues = {
  SECONDS_IN_ONE_MINUTE: 60,
  SECONDS_IN_ONE_HOUR: 60 * 60,
  SECONDS_IN_ONE_DAY: 60 * 60 * 24,
  SECONDS_IN_ONE_WEEK: 60 * 60 * 24 * 7,
  SECONDS_IN_SIX_WEEKS: 60 * 60 * 24 * 7 * 6,
  SECONDS_IN_ONE_MONTH: 60 * 60 * 24 * 30,
  SECONDS_IN_ONE_YEAR: 60 * 60 * 24 * 365,
  MINUTES_IN_ONE_WEEK: 60 * 24 * 7,
  MINUTES_IN_ONE_MONTH: 60 * 24 * 30,
  MINUTES_IN_ONE_YEAR: 60 * 24 * 365
};

const DEFAULT_ORACLE_RATE = web3.utils.toBN("2500000000000000"); // 0.25%

const DEFAULT_PRICE_FEED_DATA = [
  '0x010000000001000c1981d11e8acf2057d85174c81b4b6965aa09b879c208942cfd361c5ccdffb26f9556e278cabde16355d6047f111aee3f5e193961975dfe76bca342a9d681ce006433b437000000000001f346195ac02f37d60d4db8ffa6ef74cb1be3550047543a4a9ee9acf4d78697b0000000000c56fe3b0150325748000300010001020005009d5a797b6a411031a1047d86b0fdf86e2455be8e7fef16aef23db209723daf941f61226d39beea19d334f17c2febce27e12646d84675924ebb02b9cdaea68727e30000000041ac9ad8000000000005a1e8fffffff80000000041a04ec0000000000005e005010000000200000002000000006433b437000000006433b436000000006433b4360000000041ac9ad8000000000005a1e8000000006433b436b5885d66d3515e98348ec332593b5d16e0fdb853efb61ed5dcc0bcf80e916081d7566a3ba7f7286ed54f4ae7e983f4420ae0b1e0f3892e11f9c4ab107bbad7b9000000006894dbe7000000000009bd2bfffffff80000000068a9896400000000000a3910010000000200000002000000006433b437000000006433b436000000006433b436000000006894dbe7000000000009bd2b000000006433b43637fb6d4bff191280a7cff80bf5eda7a87c151a91d9a85ba4a8f8e2cf957e418db327d9cf0ecd793a175fa70ac8d2dc109d4462758e556962c4a87b02ec4f3f1500000000322d0171000000000006150dfffffff80000000032303482000000000004d680010000000200000002000000006433b437000000006433b436000000006433b43600000000322d0171000000000006150d000000006433b4361cdb1a5e1e3456d2977ee0d3d70765239f08a42855b9508fd479e15c6dc4d1feecf553770d9b10965f8fb64771e93f5690a182edc32be4a3236e0caaa6e0581a000000074a8a76050000000000d7773bfffffff8000000074966f0300000000000bcd233010000000200000002000000006433b437000000006433b436000000006433b436000000074a8a76050000000000d7773b000000006433b4366a20671c0e3f8cb219ce3f46e5ae096a4f2fdf936d2bd4da8925f70087d51dd830029479598797290e3638a1712c29bde2367d0eca794f778b25b5a472f192de00000002e7840fc30000000000404bddfffffff800000002e842a8700000000000397d5d010000000200000002000000006433b437000000006433b436000000006433b43600000002e7840fc30000000000404bdd000000006433b436'
];
// const DEFAULT_PRICE_FEED_DATA = ['0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace'];

class TestHelper {
  static dec(val, scale) {
    let zerosCount;

    if (scale == "ether") {
      zerosCount = 18;
    } else if (scale == "finney") zerosCount = 15;
    else {
      zerosCount = scale;
    }

    const strVal = val.toString();
    const strZeros = "0".repeat(zerosCount);

    return strVal.concat(strZeros);
  }

  static squeezeAddr(address) {
    const len = address.length;
    return address
      .slice(0, 6)
      .concat("...")
      .concat(address.slice(len - 4, len));
  }

  static getDifference(x, y) {
    const x_BN = web3.utils.toBN(x);
    const y_BN = web3.utils.toBN(y);

    return Number(x_BN.sub(y_BN).abs());
  }
  
  static getDifferenceBN(x, y) {
    return Number(x.sub(y).abs());
  }

  static assertIsApproximatelyEqual(x, y, error = 1000) {
    assert.isAtMost(this.getDifference(x, y), error);
  }

  static zipToObject(array1, array2) {
    let obj = {};
    array1.forEach((element, idx) => (obj[element] = array2[idx]));
    return obj;
  }

  static getGasMetrics(gasCostList) {
    const minGas = Math.min(...gasCostList);
    const maxGas = Math.max(...gasCostList);

    let sum = 0;
    for (const gas of gasCostList) {
      sum += gas;
    }

    if (sum === 0) {
      return {
        gasCostList: gasCostList,
        minGas: undefined,
        maxGas: undefined,
        meanGas: undefined,
        medianGas: undefined
      };
    }
    const meanGas = sum / gasCostList.length;

    // median is the middle element (for odd list size) or element adjacent-right of middle (for even list size)
    const sortedGasCostList = [...gasCostList].sort();
    const medianGas = sortedGasCostList[Math.floor(sortedGasCostList.length / 2)];
    return { gasCostList, minGas, maxGas, meanGas, medianGas };
  }

  static getGasMinMaxAvg(gasCostList) {
    const metrics = th.getGasMetrics(gasCostList);

    const minGas = metrics.minGas;
    const maxGas = metrics.maxGas;
    const meanGas = metrics.meanGas;
    const medianGas = metrics.medianGas;

    return { minGas, maxGas, meanGas, medianGas };
  }

  static getEndOfAccount(account) {
    const accountLast2bytes = account.slice(account.length - 4, account.length);
    return accountLast2bytes;
  }

  static randDecayFactor(min, max) {
    const amount = Math.random() * (max - min) + min;
    const amountInWei = web3.utils.toWei(amount.toFixed(18), "ether");
    return amountInWei;
  }

  static randAmountInWei(min, max) {
    const amount = Math.random() * (max - min) + min;
    const amountInWei = web3.utils.toWei(amount.toString(), "ether");
    return amountInWei;
  }

  static randAmountInGWei(min, max) {
    const amount = Math.floor(Math.random() * (max - min) + min);
    const amountInWei = web3.utils.toWei(amount.toString(), "gwei");
    return amountInWei;
  }

  static makeWei(num) {
    return web3.utils.toWei(num.toString(), "ether");
  }

  static appendData(results, message, data) {
    data.push(message + `\n`);
    for (const key in results) {
      data.push(key + "," + results[key] + "\n");
    }
  }

  static getRandICR(min, max) {
    const ICR_Percent = Math.floor(Math.random() * (max - min) + min);

    // Convert ICR to a duint
    const ICR = web3.utils.toWei((ICR_Percent * 10).toString(), "finney");
    return ICR;
  }

  static computeICR(coll, debt, price) {
    const collBN = web3.utils.toBN(coll);
    const debtBN = web3.utils.toBN(debt);
    const priceBN = web3.utils.toBN(price);

    const ICR = debtBN.eq(this.toBN("0"))
      ? this.toBN("0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff")
      : collBN.mul(priceBN).div(debtBN);

    return ICR;
  }

  static async ICRbetween100and110(account, troveManager, price) {
    const ICR = await troveManager.getCurrentICR(account, price);
    return ICR.gt(MoneyValues._ICR100) && ICR.lt(MoneyValues._MCR);
  }

  static async isUndercollateralized(account, troveManager, price) {
    const ICR = await troveManager.getCurrentICR(account, price);
    return ICR.lt(MoneyValues._MCR);
  }

  static toBN(num) {
    return web3.utils.toBN(num);
  }

  static gasUsed(tx) {
    const gas = tx.receipt.gasUsed;
    return gas;
  }

  static applyLiquidationFee(ethAmount) {
    return ethAmount.mul(this.toBN(this.dec(995, 15))).div(MoneyValues._1e18BN);
  }
  // --- Logging functions ---

  static logGasMetrics(gasResults, message) {
    console.log(
      `\n ${message} \n
      min gas: ${gasResults.minGas} \n
      max gas: ${gasResults.maxGas} \n
      mean gas: ${gasResults.meanGas} \n
      median gas: ${gasResults.medianGas} \n`
    );
  }

  static logAllGasCosts(gasResults) {
    console.log(`all gas costs: ${gasResults.gasCostList} \n`);
  }

  static logGas(gas, message) {
    console.log(
      `\n ${message} \n
      gas used: ${gas} \n`
    );
  }

  static async logActiveAccounts(contracts, n) {
    const count = await contracts.sortedTroves.getSize();
    const price = await contracts.priceFeedTestnet.getPrice();

    n = typeof n == "undefined" ? count : n;

    let account = await contracts.sortedTroves.getLast();
    const head = await contracts.sortedTroves.getFirst();

    console.log(`Total active accounts: ${count}`);
    console.log(`First ${n} accounts, in ascending ICR order:`);

    let i = 0;
    while (i < n) {
      const squeezedAddr = this.squeezeAddr(account);
      const coll = (await contracts.troveManager.Troves(account))[1];
      const debt = (await contracts.troveManager.Troves(account))[0];
      const ICR = await contracts.troveManager.getCurrentICR(account, price);

      console.log(`Acct: ${squeezedAddr}  coll:${coll}  debt: ${debt}  ICR: ${ICR}`);

      if (account == head) {
        break;
      }

      account = await contracts.sortedTroves.getPrev(account);

      i++;
    }
  }

  static async logAccountsArray(accounts, troveManager, price, n) {
    const length = accounts.length;

    n = typeof n == "undefined" ? length : n;

    console.log(`Number of accounts in array: ${length}`);
    console.log(`First ${n} accounts of array:`);

    for (let i = 0; i < accounts.length; i++) {
      const account = accounts[i];

      const squeezedAddr = this.squeezeAddr(account);
      const coll = (await troveManager.Troves(account))[1];
      const debt = (await troveManager.Troves(account))[0];
      const ICR = await troveManager.getCurrentICR(account, price);

      console.log(`Acct: ${squeezedAddr}  coll:${coll}  debt: ${debt}  ICR: ${ICR}`);
    }
  }

  static logBN(label, x) {
    x = x.toString().padStart(18, "0");
    // TODO: thousand separators
    const integerPart = x.slice(0, x.length - 18) ? x.slice(0, x.length - 18) : "0";
    console.log(`${label}:`, integerPart + "." + x.slice(-18));
  }

  // --- TCR and Recovery Mode functions ---

  // These functions use the PriceFeedTestNet view price function getPrice() which is sufficient for testing.
  // the mainnet contract PriceFeed uses fetchPrice, which is non-view and writes to storage.

  // To checkRecoveryMode / getTCR from the Sable mainnet contracts, pass a price value - this can be the lastGoodPrice
  // stored in Sable, or the current Chainlink BNBUSD price, etc.

  static async checkRecoveryMode(contracts) {
    const price = await contracts.priceFeedTestnet.getPrice();
    return contracts.troveManager.checkRecoveryMode(price);
  }

  static async getTCR(contracts) {
    const price = await contracts.priceFeedTestnet.getPrice();
    return contracts.troveManager.getTCR(price);
  }

  // --- Gas compensation calculation functions ---

  // Given a composite debt, returns the actual debt  - i.e. subtracts the virtual debt.
  // Virtual debt = 50 USDS.
  static async getActualDebtFromComposite(compositeDebt, contracts) {
    const issuedDebt = await contracts.troveManager.getActualDebtFromComposite(compositeDebt);
    return issuedDebt;
  }

  // Adds the gas compensation (50 USDS)
  static async getCompositeDebt(contracts, debt) {
    const compositeDebt = contracts.borrowerOperations.getCompositeDebt(debt);
    return compositeDebt;
  }

  static async getTroveEntireColl(contracts, trove) {
    return this.toBN((await contracts.troveManager.getEntireDebtAndColl(trove))[1]);
  }

  static async getTroveEntireDebt(contracts, trove) {
    return this.toBN((await contracts.troveManager.getEntireDebtAndColl(trove))[0]);
  }

  static async getTroveStake(contracts, trove) {
    return contracts.troveManager.getTroveStake(trove);
  }

  /*
   * given the requested USDS amomunt in openTrove, returns the total debt
   * So, it adds the gas compensation and the borrowing fee
   */
  static async getOpenTroveTotalDebt(contracts, usdsAmount, oracleRate) {
    const fee = await contracts.troveManager.getBorrowingFee(usdsAmount, oracleRate);
    const compositeDebt = await this.getCompositeDebt(contracts, usdsAmount);
    return compositeDebt.add(fee);
  }

  /*
   * given the desired total debt, returns the USDS amount that needs to be requested in openTrove
   * So, it subtracts the gas compensation and then the borrowing fee
   */
  static async getOpenTroveUSDSAmount(contracts, totalDebt) {
    const actualDebt = await this.getActualDebtFromComposite(totalDebt, contracts);
    return this.getNetBorrowingAmount(contracts, actualDebt, DEFAULT_ORACLE_RATE);
  }

  // Subtracts the borrowing fee
  static async getNetBorrowingAmount(contracts, debtWithFee, oracleRate) {
    const borrowingRate = await contracts.troveManager.getBorrowingRateWithDecay(oracleRate);
    return this.toBN(debtWithFee)
      .mul(MoneyValues._1e18BN)
      .div(MoneyValues._1e18BN.add(borrowingRate));
  }

  // Adds the borrowing fee
  static async getAmountWithBorrowingFee(contracts, usdsAmount, oracleRate) {
    const fee = await contracts.troveManager.getBorrowingFee(usdsAmount, oracleRate);
    return usdsAmount.add(fee);
  }

  // Adds the redemption fee
  static async getRedemptionGrossAmount(contracts, expected, oracleRate) {
    const redemptionRate = await contracts.troveManager.getRedemptionRate(oracleRate);
    return expected.mul(MoneyValues._1e18BN).div(MoneyValues._1e18BN.add(redemptionRate));
  }

  // Get's total collateral minus total gas comp, for a series of troves.
  static async getExpectedTotalCollMinusTotalGasComp(troveList, contracts) {
    let totalCollRemainder = web3.utils.toBN("0");

    for (const trove of troveList) {
      const remainingColl = this.getCollMinusGasComp(trove, contracts);
      totalCollRemainder = totalCollRemainder.add(remainingColl);
    }
    return totalCollRemainder;
  }

  static getEmittedRedemptionValues(redemptionTx) {
    for (let i = 0; i < redemptionTx.logs.length; i++) {
      if (redemptionTx.logs[i].event === "Redemption") {
        const USDSAmount = redemptionTx.logs[i].args[0];
        const totalUSDSRedeemed = redemptionTx.logs[i].args[1];
        const totalBNBDrawn = redemptionTx.logs[i].args[2];
        const BNBFee = redemptionTx.logs[i].args[3];

        return [USDSAmount, totalUSDSRedeemed, totalBNBDrawn, BNBFee];
      }
    }
    throw "The transaction logs do not contain a redemption event";
  }

  static getEmittedLiquidationValues(liquidationTx) {
    for (let i = 0; i < liquidationTx.logs.length; i++) {
      if (liquidationTx.logs[i].event === "Liquidation") {
        const liquidatedDebt = liquidationTx.logs[i].args[0];
        const liquidatedColl = liquidationTx.logs[i].args[1];
        const collGasComp = liquidationTx.logs[i].args[2];
        const usdsGasComp = liquidationTx.logs[i].args[3];

        return [liquidatedDebt, liquidatedColl, collGasComp, usdsGasComp];
      }
    }
    throw "The transaction logs do not contain a liquidation event";
  }

  static getEmittedLiquidatedDebt(liquidationTx) {
    return this.getLiquidationEventArg(liquidationTx, 0); // LiquidatedDebt is position 0 in the Liquidation event
  }

  static getEmittedLiquidatedColl(liquidationTx) {
    return this.getLiquidationEventArg(liquidationTx, 1); // LiquidatedColl is position 1 in the Liquidation event
  }

  static getEmittedGasComp(liquidationTx) {
    return this.getLiquidationEventArg(liquidationTx, 2); // GasComp is position 2 in the Liquidation event
  }

  static getLiquidationEventArg(liquidationTx, arg) {
    for (let i = 0; i < liquidationTx.logs.length; i++) {
      if (liquidationTx.logs[i].event === "Liquidation") {
        return liquidationTx.logs[i].args[arg];
      }
    }

    throw "The transaction logs do not contain a liquidation event";
  }

  static getUSDSFeeFromUSDSBorrowingEvent(tx) {
    for (let i = 0; i < tx.logs.length; i++) {
      if (tx.logs[i].event === "USDSBorrowingFeePaid") {
        return tx.logs[i].args[1].toString();
      }
    }
    throw "The transaction logs do not contain an USDSBorrowingFeePaid event";
  }

  static getEventArgByIndex(tx, eventName, argIndex) {
    for (let i = 0; i < tx.logs.length; i++) {
      if (tx.logs[i].event === eventName) {
        return tx.logs[i].args[argIndex];
      }
    }
    throw `The transaction logs do not contain event ${eventName}`;
  }

  static getEventArgByName(tx, eventName, argName) {
    for (let i = 0; i < tx.logs.length; i++) {
      if (tx.logs[i].event === eventName) {
        const keys = Object.keys(tx.logs[i].args);
        for (let j = 0; j < keys.length; j++) {
          if (keys[j] === argName) {
            return tx.logs[i].args[keys[j]];
          }
        }
      }
    }

    throw `The transaction logs do not contain event ${eventName} and arg ${argName}`;
  }

  static getAllEventsByName(tx, eventName) {
    const events = [];
    for (let i = 0; i < tx.logs.length; i++) {
      if (tx.logs[i].event === eventName) {
        events.push(tx.logs[i]);
      }
    }
    return events;
  }

  static getDebtAndCollFromTroveUpdatedEvents(troveUpdatedEvents, address) {
    const event = troveUpdatedEvents.filter(event => event.args[0] === address)[0];
    return [event.args[1], event.args[2]];
  }

  static async getBorrowerOpsListHint(contracts, newColl, newDebt) {
    const newNICR = await contracts.hintHelpers.computeNominalCR(newColl, newDebt);
    const {
      hintAddress: approxfullListHint,
      latestRandomSeed
    } = await contracts.hintHelpers.getApproxHint(newNICR, 5, this.latestRandomSeed);
    this.latestRandomSeed = latestRandomSeed;

    const { 0: upperHint, 1: lowerHint } = await contracts.sortedTroves.findInsertPosition(
      newNICR,
      approxfullListHint,
      approxfullListHint
    );
    return { upperHint, lowerHint };
  }

  static async getEntireCollAndDebt(contracts, account) {
    // console.log(`account: ${account}`)
    const rawColl = (await contracts.troveManager.Troves(account))[1];
    const rawDebt = (await contracts.troveManager.Troves(account))[0];
    const pendingBNBReward = await contracts.troveManager.getPendingBNBReward(account);
    const pendingUSDSDebtReward = await contracts.troveManager.getPendingUSDSDebtReward(account);
    const entireColl = rawColl.add(pendingBNBReward);
    const entireDebt = rawDebt.add(pendingUSDSDebtReward);

    return { entireColl, entireDebt };
  }

  static async getCollAndDebtFromAddColl(contracts, account, amount) {
    const { entireColl, entireDebt } = await this.getEntireCollAndDebt(contracts, account);

    const newColl = entireColl.add(this.toBN(amount));
    const newDebt = entireDebt;
    return { newColl, newDebt };
  }

  static async getCollAndDebtFromWithdrawColl(contracts, account, amount) {
    const { entireColl, entireDebt } = await this.getEntireCollAndDebt(contracts, account);
    // console.log(`entireColl  ${entireColl}`)
    // console.log(`entireDebt  ${entireDebt}`)

    const newColl = entireColl.sub(this.toBN(amount));
    const newDebt = entireDebt;
    return { newColl, newDebt };
  }

  static async getCollAndDebtFromWithdrawUSDS(contracts, account, amount, oracleRate) {
    const fee = await contracts.troveManager.getBorrowingFee(amount, oracleRate);
    const { entireColl, entireDebt } = await this.getEntireCollAndDebt(contracts, account);

    const newColl = entireColl;
    const newDebt = entireDebt.add(this.toBN(amount)).add(fee);

    return { newColl, newDebt };
  }

  static async getCollAndDebtFromRepayUSDS(contracts, account, amount) {
    const { entireColl, entireDebt } = await this.getEntireCollAndDebt(contracts, account);

    const newColl = entireColl;
    const newDebt = entireDebt.sub(this.toBN(amount));

    return { newColl, newDebt };
  }

  static async getCollAndDebtFromAdjustment(contracts, account, BNBChange, USDSChange, oracleRate) {
    const { entireColl, entireDebt } = await this.getEntireCollAndDebt(contracts, account);

    // const coll = (await contracts.troveManager.Troves(account))[1]
    // const debt = (await contracts.troveManager.Troves(account))[0]

    const fee = USDSChange.gt(this.toBN("0"))
      ? await contracts.troveManager.getBorrowingFee(USDSChange, oracleRate)
      : this.toBN("0");
    const newColl = entireColl.add(BNBChange);
    const newDebt = entireDebt.add(USDSChange).add(fee);

    return { newColl, newDebt };
  }

  // --- BorrowerOperations gas functions ---

  static async openTrove_allAccounts(accounts, contracts, BNBAmount, USDSAmount) {
    const gasCostList = [];
    const totalDebt = await this.getOpenTroveTotalDebt(contracts, USDSAmount, DEFAULT_ORACLE_RATE);

    for (const account of accounts) {
      const { upperHint, lowerHint } = await this.getBorrowerOpsListHint(
        contracts,
        BNBAmount,
        totalDebt
      );

      const tx = await contracts.borrowerOperations.openTrove(
        this._100pct,
        USDSAmount,
        upperHint,
        lowerHint,
        DEFAULT_PRICE_FEED_DATA,
        { from: account, value: BNBAmount }
      );
      const gas = this.gasUsed(tx);
      gasCostList.push(gas);
    }
    return this.getGasMetrics(gasCostList);
  }

  static async openTrove_allAccounts_randomBNB(minBNB, maxBNB, accounts, contracts, USDSAmount) {
    const gasCostList = [];
    const totalDebt = await this.getOpenTroveTotalDebt(contracts, USDSAmount, DEFAULT_ORACLE_RATE);

    for (const account of accounts) {
      const randCollAmount = this.randAmountInWei(minBNB, maxBNB);
      const { upperHint, lowerHint } = await this.getBorrowerOpsListHint(
        contracts,
        randCollAmount,
        totalDebt
      );

      const tx = await contracts.borrowerOperations.openTrove(
        this._100pct,
        USDSAmount,
        upperHint,
        lowerHint,
        DEFAULT_PRICE_FEED_DATA,
        { from: account, value: randCollAmount }
      );
      const gas = this.gasUsed(tx);
      gasCostList.push(gas);
    }
    return this.getGasMetrics(gasCostList);
  }

  static async openTrove_allAccounts_randomBNB_ProportionalUSDS(
    minBNB,
    maxBNB,
    accounts,
    contracts,
    proportion
  ) {
    const gasCostList = [];

    for (const account of accounts) {
      const randCollAmount = this.randAmountInWei(minBNB, maxBNB);
      const proportionalUSDS = web3.utils.toBN(proportion).mul(web3.utils.toBN(randCollAmount));
      const totalDebt = await this.getOpenTroveTotalDebt(contracts, proportionalUSDS, DEFAULT_ORACLE_RATE);

      const { upperHint, lowerHint } = await this.getBorrowerOpsListHint(
        contracts,
        randCollAmount,
        totalDebt
      );

      const tx = await contracts.borrowerOperations.openTrove(
        this._100pct,
        proportionalUSDS,
        upperHint,
        lowerHint,
        DEFAULT_PRICE_FEED_DATA,
        { from: account, value: randCollAmount }
      );
      const gas = this.gasUsed(tx);
      gasCostList.push(gas);
    }
    return this.getGasMetrics(gasCostList);
  }

  static async openTrove_allAccounts_randomBNB_randomUSDS(
    minBNB,
    maxBNB,
    accounts,
    contracts,
    minUSDSProportion,
    maxUSDSProportion,
    logging = false
  ) {
    const gasCostList = [];
    const price = await contracts.priceFeedTestnet.getPrice();
    const _1e18 = web3.utils.toBN("1000000000000000000");

    let i = 0;
    for (const account of accounts) {
      const randCollAmount = this.randAmountInWei(minBNB, maxBNB);
      // console.log(`randCollAmount ${randCollAmount }`)
      const randUSDSProportion = this.randAmountInWei(minUSDSProportion, maxUSDSProportion);
      const proportionalUSDS = web3.utils
        .toBN(randUSDSProportion)
        .mul(web3.utils.toBN(randCollAmount).div(_1e18));
      const totalDebt = await this.getOpenTroveTotalDebt(contracts, proportionalUSDS, DEFAULT_ORACLE_RATE);
      const { upperHint, lowerHint } = await this.getBorrowerOpsListHint(
        contracts,
        randCollAmount,
        totalDebt
      );

      const feeFloor = this.dec(5, 16);
      const tx = await contracts.borrowerOperations.openTrove(
        this._100pct,
        proportionalUSDS,
        upperHint,
        lowerHint,
        DEFAULT_PRICE_FEED_DATA,
        { from: account, value: randCollAmount }
      );

      if (logging && tx.receipt.status) {
        i++;
        const ICR = await contracts.troveManager.getCurrentICR(account, price);
        // console.log(`${i}. Trove opened. addr: ${this.squeezeAddr(account)} coll: ${randCollAmount} debt: ${proportionalUSDS} ICR: ${ICR}`)
      }
      const gas = this.gasUsed(tx);
      gasCostList.push(gas);
    }
    return this.getGasMetrics(gasCostList);
  }

  static async openTrove_allAccounts_randomUSDS(minUSDS, maxUSDS, accounts, contracts, BNBAmount) {
    const gasCostList = [];

    for (const account of accounts) {
      const randUSDSAmount = this.randAmountInWei(minUSDS, maxUSDS);
      const totalDebt = await this.getOpenTroveTotalDebt(contracts, randUSDSAmount, DEFAULT_ORACLE_RATE);
      const { upperHint, lowerHint } = await this.getBorrowerOpsListHint(
        contracts,
        BNBAmount,
        totalDebt
      );

      const tx = await contracts.borrowerOperations.openTrove(
        this._100pct,
        randUSDSAmount,
        upperHint,
        lowerHint,
        DEFAULT_PRICE_FEED_DATA,
        { from: account, value: BNBAmount }
      );
      const gas = this.gasUsed(tx);
      gasCostList.push(gas);
    }
    return this.getGasMetrics(gasCostList);
  }

  static async closeTrove_allAccounts(accounts, contracts) {
    const gasCostList = [];

    for (const account of accounts) {
      const tx = await contracts.borrowerOperations.closeTrove({ from: account });
      const gas = this.gasUsed(tx);
      gasCostList.push(gas);
    }
    return this.getGasMetrics(gasCostList);
  }

  static async openTrove_allAccounts_decreasingUSDSAmounts(
    accounts,
    contracts,
    BNBAmount,
    maxUSDSAmount
  ) {
    const gasCostList = [];

    let i = 0;
    for (const account of accounts) {
      const USDSAmount = (maxUSDSAmount - i).toString();
      const USDSAmountWei = web3.utils.toWei(USDSAmount, "ether");
      const totalDebt = await this.getOpenTroveTotalDebt(contracts, USDSAmountWei, DEFAULT_ORACLE_RATE);
      const { upperHint, lowerHint } = await this.getBorrowerOpsListHint(
        contracts,
        BNBAmount,
        totalDebt
      );

      const tx = await contracts.borrowerOperations.openTrove(
        this._100pct,
        USDSAmountWei,
        upperHint,
        lowerHint,
        DEFAULT_PRICE_FEED_DATA,
        { from: account, value: BNBAmount }
      );
      const gas = this.gasUsed(tx);
      gasCostList.push(gas);
      i += 1;
    }
    return this.getGasMetrics(gasCostList);
  }

  static async openTrove(
    contracts,
    { maxFeePercentage, extraUSDSAmount, upperHint, lowerHint, ICR, extraParams }
  ) {
    if (!maxFeePercentage) maxFeePercentage = this._100pct;
    if (!extraUSDSAmount) extraUSDSAmount = this.toBN(0);
    else if (typeof extraUSDSAmount == "string") extraUSDSAmount = this.toBN(extraUSDSAmount);
    if (!upperHint) upperHint = this.ZERO_ADDRESS;
    if (!lowerHint) lowerHint = this.ZERO_ADDRESS;

    const MIN_DEBT = (
      await this.getNetBorrowingAmount(contracts, await contracts.systemState.getMinNetDebt(), DEFAULT_ORACLE_RATE)
    ).add(this.toBN(1)); // add 1 to avoid rounding issues
    const usdsAmount = MIN_DEBT.add(extraUSDSAmount);

    if (!ICR && !extraParams.value) ICR = this.toBN(this.dec(15, 17));
    // 150%
    else if (typeof ICR == "string") ICR = this.toBN(ICR);

    const totalDebt = await this.getOpenTroveTotalDebt(contracts, usdsAmount, DEFAULT_ORACLE_RATE);
    const netDebt = await this.getActualDebtFromComposite(totalDebt, contracts);

    if (ICR) {
      const price = await contracts.priceFeedTestnet.getPrice();
      extraParams.value = ICR.mul(totalDebt).div(price);
    }

    const tx = await contracts.borrowerOperations.openTrove(
      maxFeePercentage,
      usdsAmount,
      upperHint,
      lowerHint,
      DEFAULT_PRICE_FEED_DATA,
      extraParams
    );

    return {
      usdsAmount,
      netDebt,
      totalDebt,
      ICR,
      collateral: extraParams.value,
      tx
    };
  }

  static async withdrawUSDS(
    contracts,
    { maxFeePercentage, usdsAmount, ICR, upperHint, lowerHint, extraParams }
  ) {
    if (!maxFeePercentage) maxFeePercentage = this._100pct;
    if (!upperHint) upperHint = this.ZERO_ADDRESS;
    if (!lowerHint) lowerHint = this.ZERO_ADDRESS;

    assert(
      !(usdsAmount && ICR) && (usdsAmount || ICR),
      "Specify either usds amount or target ICR, but not both"
    );

    let increasedTotalDebt;
    if (ICR) {
      assert(extraParams.from, "A from account is needed");
      const { debt, coll } = await contracts.troveManager.getEntireDebtAndColl(extraParams.from);
      const price = await contracts.priceFeedTestnet.getPrice();
      const targetDebt = coll.mul(price).div(ICR);
      assert(targetDebt > debt, "ICR is already greater than or equal to target");
      increasedTotalDebt = targetDebt.sub(debt);
      usdsAmount = await this.getNetBorrowingAmount(contracts, increasedTotalDebt, DEFAULT_ORACLE_RATE);
    } else {
      increasedTotalDebt = await this.getAmountWithBorrowingFee(contracts, usdsAmount, DEFAULT_ORACLE_RATE);
    }

    await contracts.borrowerOperations.withdrawUSDS(
      maxFeePercentage,
      usdsAmount,
      upperHint,
      lowerHint,
      DEFAULT_PRICE_FEED_DATA,
      extraParams
    );

    return {
      usdsAmount,
      increasedTotalDebt
    };
  }

  static async adjustTrove_allAccounts(accounts, contracts, BNBAmount, USDSAmount) {
    const gasCostList = [];

    for (const account of accounts) {
      let tx;

      let BNBChangeBN = this.toBN(BNBAmount);
      let USDSChangeBN = this.toBN(USDSAmount);

      const { newColl, newDebt } = await this.getCollAndDebtFromAdjustment(
        contracts,
        account,
        BNBChangeBN,
        USDSChangeBN,
        DEFAULT_ORACLE_RATE
      );
      const { upperHint, lowerHint } = await this.getBorrowerOpsListHint(
        contracts,
        newColl,
        newDebt
      );

      const zero = this.toBN("0");

      let isDebtIncrease = USDSChangeBN.gt(zero);
      USDSChangeBN = USDSChangeBN.abs();

      // Add BNB to trove
      if (BNBChangeBN.gt(zero)) {
        tx = await contracts.borrowerOperations.adjustTrove(
          this._100pct,
          0,
          USDSChangeBN,
          isDebtIncrease,
          upperHint,
          lowerHint,
          { from: account, value: BNBChangeBN }
        );
        // Withdraw BNB from trove
      } else if (BNBChangeBN.lt(zero)) {
        BNBChangeBN = BNBChangeBN.neg();
        tx = await contracts.borrowerOperations.adjustTrove(
          this._100pct,
          BNBChangeBN,
          USDSChangeBN,
          isDebtIncrease,
          upperHint,
          lowerHint,
          { from: account }
        );
      }

      const gas = this.gasUsed(tx);
      gasCostList.push(gas);
    }
    return this.getGasMetrics(gasCostList);
  }

  static async adjustTrove_allAccounts_randomAmount(
    accounts,
    contracts,
    BNBMin,
    BNBMax,
    USDSMin,
    USDSMax
  ) {
    const gasCostList = [];

    for (const account of accounts) {
      let tx;

      let BNBChangeBN = this.toBN(this.randAmountInWei(BNBMin, BNBMax));
      let USDSChangeBN = this.toBN(this.randAmountInWei(USDSMin, USDSMax));

      const { newColl, newDebt } = await this.getCollAndDebtFromAdjustment(
        contracts,
        account,
        BNBChangeBN,
        USDSChangeBN,
        DEFAULT_ORACLE_RATE
      );
      const { upperHint, lowerHint } = await this.getBorrowerOpsListHint(
        contracts,
        newColl,
        newDebt
      );

      const zero = this.toBN("0");

      let isDebtIncrease = USDSChangeBN.gt(zero);
      USDSChangeBN = USDSChangeBN.abs();

      // Add BNB to trove
      if (BNBChangeBN.gt(zero)) {
        tx = await contracts.borrowerOperations.adjustTrove(
          this._100pct,
          0,
          USDSChangeBN,
          isDebtIncrease,
          upperHint,
          lowerHint,
          { from: account, value: BNBChangeBN }
        );
        // Withdraw BNB from trove
      } else if (BNBChangeBN.lt(zero)) {
        BNBChangeBN = BNBChangeBN.neg();
        tx = await contracts.borrowerOperations.adjustTrove(
          this._100pct,
          BNBChangeBN,
          USDSChangeBN,
          isDebtIncrease,
          lowerHint,
          upperHint,
          { from: account }
        );
      }

      const gas = this.gasUsed(tx);
      // console.log(`BNB change: ${BNBChangeBN},  USDSChange: ${USDSChangeBN}, gas: ${gas} `)

      gasCostList.push(gas);
    }
    return this.getGasMetrics(gasCostList);
  }

  static async addColl_allAccounts(accounts, contracts, amount) {
    const gasCostList = [];
    for (const account of accounts) {
      const { newColl, newDebt } = await this.getCollAndDebtFromAddColl(contracts, account, amount);
      const { upperHint, lowerHint } = await this.getBorrowerOpsListHint(
        contracts,
        newColl,
        newDebt
      );

      const tx = await contracts.borrowerOperations.addColl(upperHint, lowerHint, {
        from: account,
        value: amount
      });
      const gas = this.gasUsed(tx);
      gasCostList.push(gas);
    }
    return this.getGasMetrics(gasCostList);
  }

  static async addColl_allAccounts_randomAmount(min, max, accounts, contracts) {
    const gasCostList = [];
    for (const account of accounts) {
      const randCollAmount = this.randAmountInWei(min, max);

      const { newColl, newDebt } = await this.getCollAndDebtFromAddColl(
        contracts,
        account,
        randCollAmount
      );
      const { upperHint, lowerHint } = await this.getBorrowerOpsListHint(
        contracts,
        newColl,
        newDebt
      );

      const tx = await contracts.borrowerOperations.addColl(upperHint, lowerHint, {
        from: account,
        value: randCollAmount
      });
      const gas = this.gasUsed(tx);
      gasCostList.push(gas);
    }
    return this.getGasMetrics(gasCostList);
  }

  static async withdrawColl_allAccounts(accounts, contracts, amount) {
    const gasCostList = [];
    for (const account of accounts) {
      const { newColl, newDebt } = await this.getCollAndDebtFromWithdrawColl(
        contracts,
        account,
        amount
      );
      // console.log(`newColl: ${newColl} `)
      // console.log(`newDebt: ${newDebt} `)
      const { upperHint, lowerHint } = await this.getBorrowerOpsListHint(
        contracts,
        newColl,
        newDebt
      );

      const tx = await contracts.borrowerOperations.withdrawColl(amount, upperHint, lowerHint, {
        from: account
      });
      const gas = this.gasUsed(tx);
      gasCostList.push(gas);
    }
    return this.getGasMetrics(gasCostList);
  }

  static async withdrawColl_allAccounts_randomAmount(min, max, accounts, contracts) {
    const gasCostList = [];

    for (const account of accounts) {
      const randCollAmount = this.randAmountInWei(min, max);

      const { newColl, newDebt } = await this.getCollAndDebtFromWithdrawColl(
        contracts,
        account,
        randCollAmount
      );
      const { upperHint, lowerHint } = await this.getBorrowerOpsListHint(
        contracts,
        newColl,
        newDebt
      );

      const tx = await contracts.borrowerOperations.withdrawColl(
        randCollAmount,
        upperHint,
        lowerHint,
        { from: account }
      );
      const gas = this.gasUsed(tx);
      gasCostList.push(gas);
      // console.log("gasCostlist length is " + gasCostList.length)
    }
    return this.getGasMetrics(gasCostList);
  }

  static async withdrawUSDS_allAccounts(accounts, contracts, amount) {
    const gasCostList = [];

    for (const account of accounts) {
      const { newColl, newDebt } = await this.getCollAndDebtFromWithdrawUSDS(
        contracts,
        account,
        amount,
        DEFAULT_ORACLE_RATE
      );
      const { upperHint, lowerHint } = await this.getBorrowerOpsListHint(
        contracts,
        newColl,
        newDebt
      );

      const tx = await contracts.borrowerOperations.withdrawUSDS(
        this._100pct,
        amount,
        upperHint,
        lowerHint,
        DEFAULT_PRICE_FEED_DATA,
        { from: account }
      );
      const gas = this.gasUsed(tx);
      gasCostList.push(gas);
    }
    return this.getGasMetrics(gasCostList);
  }

  static async withdrawUSDS_allAccounts_randomAmount(min, max, accounts, contracts) {
    const gasCostList = [];

    for (const account of accounts) {
      const randUSDSAmount = this.randAmountInWei(min, max);

      const { newColl, newDebt } = await this.getCollAndDebtFromWithdrawUSDS(
        contracts,
        account,
        randUSDSAmount,
        DEFAULT_ORACLE_RATE
      );
      const { upperHint, lowerHint } = await this.getBorrowerOpsListHint(
        contracts,
        newColl,
        newDebt
      );

      const tx = await contracts.borrowerOperations.withdrawUSDS(
        this._100pct,
        randUSDSAmount,
        upperHint,
        lowerHint,
        DEFAULT_PRICE_FEED_DATA,
        { from: account }
      );
      const gas = this.gasUsed(tx);
      gasCostList.push(gas);
    }
    return this.getGasMetrics(gasCostList);
  }

  static async repayUSDS_allAccounts(accounts, contracts, amount) {
    const gasCostList = [];

    for (const account of accounts) {
      const { newColl, newDebt } = await this.getCollAndDebtFromRepayUSDS(
        contracts,
        account,
        amount
      );
      const { upperHint, lowerHint } = await this.getBorrowerOpsListHint(
        contracts,
        newColl,
        newDebt
      );

      const tx = await contracts.borrowerOperations.repayUSDS(amount, upperHint, lowerHint, {
        from: account
      });
      const gas = this.gasUsed(tx);
      gasCostList.push(gas);
    }
    return this.getGasMetrics(gasCostList);
  }

  static async repayUSDS_allAccounts_randomAmount(min, max, accounts, contracts) {
    const gasCostList = [];

    for (const account of accounts) {
      const randUSDSAmount = this.randAmountInWei(min, max);

      const { newColl, newDebt } = await this.getCollAndDebtFromRepayUSDS(
        contracts,
        account,
        randUSDSAmount
      );
      const { upperHint, lowerHint } = await this.getBorrowerOpsListHint(
        contracts,
        newColl,
        newDebt
      );

      const tx = await contracts.borrowerOperations.repayUSDS(randUSDSAmount, upperHint, lowerHint, {
        from: account
      });
      const gas = this.gasUsed(tx);
      gasCostList.push(gas);
    }
    return this.getGasMetrics(gasCostList);
  }

  static async getCurrentICR_allAccounts(accounts, contracts, functionCaller) {
    const gasCostList = [];
    const price = await contracts.priceFeedTestnet.getPrice();

    for (const account of accounts) {
      const tx = await functionCaller.troveManager_getCurrentICR(account, price);
      const gas = this.gasUsed(tx) - 21000;
      gasCostList.push(gas);
    }
    return this.getGasMetrics(gasCostList);
  }

  // --- Redemption functions ---

  static async redeemCollateral(
    redeemer,
    contracts,
    USDSAmount,
    gasPrice = 0,
    maxFee = this._100pct
  ) {
    const price = await contracts.priceFeedTestnet.getPrice();
    const tx = await this.performRedemptionTx(
      redeemer,
      price,
      contracts,
      USDSAmount,
      maxFee,
      gasPrice
    );
    const gas = await this.gasUsed(tx);
    return gas;
  }

  static async redeemCollateralAndGetTxObject(
    redeemer,
    contracts,
    USDSAmount,
    gasPrice,
    maxFee = this._100pct
  ) {
    // console.log("GAS PRICE:  " + gasPrice)
    if (gasPrice == undefined) {
      gasPrice = 0;
    }
    const price = await contracts.priceFeedTestnet.getPrice();
    const tx = await this.performRedemptionTx(
      redeemer,
      price,
      contracts,
      USDSAmount,
      maxFee,
      gasPrice
    );
    return tx;
  }

  static async redeemCollateral_allAccounts_randomAmount(min, max, accounts, contracts) {
    const gasCostList = [];
    const price = await contracts.priceFeedTestnet.getPrice();

    for (const redeemer of accounts) {
      const randUSDSAmount = this.randAmountInWei(min, max);

      await this.performRedemptionTx(redeemer, price, contracts, randUSDSAmount);
      const gas = this.gasUsed(tx);
      gasCostList.push(gas);
    }
    return this.getGasMetrics(gasCostList);
  }

  static async performRedemptionTx(
    redeemer,
    price,
    contracts,
    USDSAmount,
    maxFee = 0,
    gasPrice_toUse = 0
  ) {
    const redemptionhint = await contracts.hintHelpers.getRedemptionHints(
      USDSAmount,
      price,
      gasPrice_toUse
    );

    const firstRedemptionHint = redemptionhint[0];
    const partialRedemptionNewICR = redemptionhint[1];

    const {
      hintAddress: approxPartialRedemptionHint,
      latestRandomSeed
    } = await contracts.hintHelpers.getApproxHint(
      partialRedemptionNewICR,
      50,
      this.latestRandomSeed
    );
    this.latestRandomSeed = latestRandomSeed;

    const exactPartialRedemptionHint = await contracts.sortedTroves.findInsertPosition(
      partialRedemptionNewICR,
      approxPartialRedemptionHint,
      approxPartialRedemptionHint
    );

    const tx = await contracts.troveManager.redeemCollateral(
      USDSAmount,
      firstRedemptionHint,
      exactPartialRedemptionHint[0],
      exactPartialRedemptionHint[1],
      partialRedemptionNewICR,
      0,
      maxFee,
      DEFAULT_PRICE_FEED_DATA,
      { from: redeemer, gasPrice: gasPrice_toUse }
    );

    return tx;
  }

  // --- Composite functions ---

  static async makeTrovesIncreasingICR(accounts, contracts) {
    let amountFinney = 2000;

    for (const account of accounts) {
      const coll = web3.utils.toWei(amountFinney.toString(), "finney");

      await contracts.borrowerOperations.openTrove(
        this._100pct,
        "200000000000000000000",
        account,
        account,
        DEFAULT_PRICE_FEED_DATA,
        { from: account, value: coll }
      );

      amountFinney += 10;
    }
  }

  // --- StabilityPool gas functions ---

  static async provideToSP_allAccounts(accounts, stabilityPool, amount) {
    const gasCostList = [];
    for (const account of accounts) {
      const tx = await stabilityPool.provideToSP(amount, this.ZERO_ADDRESS, { from: account });
      const gas = this.gasUsed(tx);
      gasCostList.push(gas);
    }
    return this.getGasMetrics(gasCostList);
  }

  static async provideToSP_allAccounts_randomAmount(min, max, accounts, stabilityPool) {
    const gasCostList = [];
    for (const account of accounts) {
      const randomUSDSAmount = this.randAmountInWei(min, max);
      const tx = await stabilityPool.provideToSP(randomUSDSAmount, this.ZERO_ADDRESS, {
        from: account
      });
      const gas = this.gasUsed(tx);
      gasCostList.push(gas);
    }
    return this.getGasMetrics(gasCostList);
  }

  static async withdrawFromSP_allAccounts(accounts, stabilityPool, amount) {
    const gasCostList = [];
    for (const account of accounts) {
      const tx = await stabilityPool.withdrawFromSP(amount, { from: account });
      const gas = this.gasUsed(tx);
      gasCostList.push(gas);
    }
    return this.getGasMetrics(gasCostList);
  }

  static async withdrawFromSP_allAccounts_randomAmount(min, max, accounts, stabilityPool) {
    const gasCostList = [];
    for (const account of accounts) {
      const randomUSDSAmount = this.randAmountInWei(min, max);
      const tx = await stabilityPool.withdrawFromSP(randomUSDSAmount, { from: account });
      const gas = this.gasUsed(tx);
      gasCostList.push(gas);
    }
    return this.getGasMetrics(gasCostList);
  }

  static async withdrawBNBGainToTrove_allAccounts(accounts, contracts) {
    const gasCostList = [];
    for (const account of accounts) {
      let { entireColl, entireDebt } = await this.getEntireCollAndDebt(contracts, account);
      console.log(`entireColl: ${entireColl}`);
      console.log(`entireDebt: ${entireDebt}`);
      const BNBGain = await contracts.stabilityPool.getDepositorBNBGain(account);
      const newColl = entireColl.add(BNBGain);
      const { upperHint, lowerHint } = await this.getBorrowerOpsListHint(
        contracts,
        newColl,
        entireDebt
      );

      const tx = await contracts.stabilityPool.withdrawBNBGainToTrove(upperHint, lowerHint, {
        from: account
      });
      const gas = this.gasUsed(tx);
      gasCostList.push(gas);
    }
    return this.getGasMetrics(gasCostList);
  }

  // --- SABLE & Lockup Contract functions ---

  static getLCAddressFromDeploymentTx(deployedLCTx) {
    return deployedLCTx.logs[0].args[0];
  }

  static async getLCFromDeploymentTx(deployedLCTx) {
    const deployedLCAddress = this.getLCAddressFromDeploymentTx(deployedLCTx); // grab addr of deployed contract from event
    const LC = await this.getLCFromAddress(deployedLCAddress);
    return LC;
  }

  static async registerFrontEnds(frontEnds, stabilityPool) {
    for (const frontEnd of frontEnds) {
      await stabilityPool.registerFrontEnd(this.dec(5, 17), { from: frontEnd }); // default kickback rate of 50%
    }
  }

  // --- Time functions ---

  static async fastForwardTime(seconds, currentWeb3Provider) {
    await currentWeb3Provider.send(
      {
        id: 0,
        jsonrpc: "2.0",
        method: "evm_increaseTime",
        params: [seconds]
      },
      err => {
        if (err) console.log(err);
      }
    );

    await currentWeb3Provider.send(
      {
        id: 0,
        jsonrpc: "2.0",
        method: "evm_mine"
      },
      err => {
        if (err) console.log(err);
      }
    );
  }

  static async getLatestBlockTimestamp(web3Instance) {
    const blockNumber = await web3Instance.eth.getBlockNumber();
    const block = await web3Instance.eth.getBlock(blockNumber);

    return block.timestamp;
  }

  static async getTimestampFromTx(tx, web3Instance) {
    return this.getTimestampFromTxReceipt(tx.receipt, web3Instance);
  }

  static async getTimestampFromTxReceipt(txReceipt, web3Instance) {
    const block = await web3Instance.eth.getBlock(txReceipt.blockNumber);
    return block.timestamp;
  }

  static secondsToDays(seconds) {
    return Number(seconds) / (60 * 60 * 24);
  }

  static daysToSeconds(days) {
    return Number(days) * (60 * 60 * 24);
  }

  static async getTimeFromSystemDeployment(sableToken, web3, timePassedSinceDeployment) {
    const deploymentTime = await sableToken.getDeploymentStartTime();
    return this.toBN(deploymentTime).add(this.toBN(timePassedSinceDeployment));
  }

  // --- Assert functions ---

  static async assertRevert(txPromise, message = undefined) {
    try {
      const tx = await txPromise;
      // console.log("tx succeeded")
      assert.isFalse(tx.receipt.status); // when this assert fails, the expected revert didn't occur, i.e. the tx succeeded
    } catch (err) {
      // console.log("tx failed")
      assert.include(err.message, "revert");
      // TODO: ensure this function runs properly on other test scripts

      if (message) {
        assert.include(err.message, message)
      }
    }
  }

  static async assertAssertRevert(txPromise, message = undefined) {
    try {
      const tx = await txPromise;
      assert.isFalse(tx.receipt.status); // when this assert fails, the expected revert didn't occur, i.e. the tx succeeded
    } catch (err) {
      if (message) {
        assert.include(err.message, message)
      }
    }
  }

  static async assertInvalidOpcode(txPromise) {
    try {
      const tx = await txPromise;
      assert.isFalse(tx.receipt.status); // when this assert fails, the expected revert didn't occur, i.e. the tx succeeded
    } catch (err) {
      assert.include(err.message, "invalid opcode");
    }
  }

  static async assertAssert(txPromise) {
    try {
      const tx = await txPromise;
      assert.isFalse(tx.receipt.status); // when this assert fails, the expected revert didn't occur, i.e. the tx succeeded
    } catch (err) {
      assert.include(err.message, "invalid opcode");
    }
  }

  // --- Misc. functions  ---

  static async forceSendEth(from, receiver, value) {
    const destructible = await Destructible.new();
    await web3.eth.sendTransaction({ to: destructible.address, from, value });
    await destructible.destruct(receiver);
  }

  static hexToParam(hexValue) {
    return ("0".repeat(64) + hexValue.slice(2)).slice(-64);
  }

  static formatParam(param) {
    let formattedParam = param;
    if (
      typeof param == "number" ||
      typeof param == "object" ||
      (typeof param == "string" && new RegExp("[0-9]*").test(param))
    ) {
      formattedParam = web3.utils.toHex(formattedParam);
    } else if (typeof param == "boolean") {
      formattedParam = param ? "0x01" : "0x00";
    } else if (param.slice(0, 2) != "0x") {
      formattedParam = web3.utils.asciiToHex(formattedParam);
    }

    return this.hexToParam(formattedParam);
  }
  static getTransactionData(signatureString, params) {
    /*
     console.log('signatureString: ', signatureString)
     console.log('params: ', params)
     console.log('params: ', params.map(p => typeof p))
     */
    return (
      web3.utils.sha3(signatureString).slice(0, 10) +
      params.reduce((acc, p) => acc + this.formatParam(p), "")
    );
  }
}

TestHelper.ZERO_ADDRESS = "0x" + "0".repeat(40);
TestHelper.maxBytes32 = "0x" + "f".repeat(64);
TestHelper._100pct = "1000000000000000000";
TestHelper.latestRandomSeed = 31337;

module.exports = {
  TestHelper,
  MoneyValues,
  TimeValues,
  DEFAULT_ORACLE_RATE,
  DEFAULT_PRICE_FEED_DATA
};
