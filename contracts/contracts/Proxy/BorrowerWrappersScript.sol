// SPDX-License-Identifier: MIT

pragma solidity 0.6.11;
pragma experimental ABIEncoderV2;

import "../Dependencies/SafeMath.sol";
import "../Dependencies/LiquityMath.sol";
import "../Dependencies/IERC20.sol";
import "../Interfaces/IBorrowerOperations.sol";
import "../Interfaces/ITroveManager.sol";
import "../Interfaces/IStabilityPool.sol";
import "../Interfaces/IPriceFeed.sol";
import "../Interfaces/ISABLEStaking.sol";
import "../Interfaces/IOracleRateCalculation.sol";
import "./BorrowerOperationsScript.sol";
import "./BNBTransferScript.sol";
import "./SABLEStakingScript.sol";
import "../Dependencies/console.sol";

contract BorrowerWrappersScript is BorrowerOperationsScript, BNBTransferScript, SABLEStakingScript {
    using SafeMath for uint;

    string constant public NAME = "BorrowerWrappersScript";

    ITroveManager immutable troveManager;
    IStabilityPool immutable stabilityPool;
    IPriceFeed immutable priceFeed;
    IERC20 immutable usdsToken;
    IERC20 immutable sableToken;
    ISABLEStaking immutable sableStaking;
    IOracleRateCalculation immutable oracleRateCalc;

    constructor(
        address _borrowerOperationsAddress,
        address _troveManagerAddress,
        address _sableStakingAddress
    )
        BorrowerOperationsScript(IBorrowerOperations(_borrowerOperationsAddress))
        SABLEStakingScript(_sableStakingAddress)
        public
    {
        checkContract(_troveManagerAddress);
        ITroveManager troveManagerCached = ITroveManager(_troveManagerAddress);
        troveManager = troveManagerCached;

        IStabilityPool stabilityPoolCached = troveManagerCached.stabilityPool();
        checkContract(address(stabilityPoolCached));
        stabilityPool = stabilityPoolCached;

        IPriceFeed priceFeedCached = troveManagerCached.priceFeed();
        checkContract(address(priceFeedCached));
        priceFeed = priceFeedCached;

        address usdsTokenCached = address(troveManagerCached.usdsToken());
        checkContract(usdsTokenCached);
        usdsToken = IERC20(usdsTokenCached);

        address sableTokenCached = address(troveManagerCached.sableToken());
        checkContract(sableTokenCached);
        sableToken = IERC20(sableTokenCached);

        ISABLEStaking sableStakingCached = troveManagerCached.sableStaking();
        require(_sableStakingAddress == address(sableStakingCached), "BorrowerWrappersScript: Wrong SABLEStaking address");
        sableStaking = sableStakingCached;

        IOracleRateCalculation oracleRateCalcCached = troveManagerCached.oracleRateCalc();
        checkContract(address(oracleRateCalcCached));
        oracleRateCalc = oracleRateCalcCached;
    }

    function claimCollateralAndOpenTrove(
        uint _maxFee, 
        uint _USDSAmount, 
        address _upperHint, 
        address _lowerHint,
        bytes[] calldata priceFeedUpdateData
    ) external payable {
        uint balanceBefore = address(this).balance;

        // Claim collateral
        borrowerOperations.claimCollateral();

        uint balanceAfter = address(this).balance;

        // already checked in CollSurplusPool
        assert(balanceAfter > balanceBefore);

        uint totalCollateral = balanceAfter.sub(balanceBefore).add(msg.value);

        // Open trove with obtained collateral, plus collateral sent by user
        borrowerOperations.openTrove{ value: totalCollateral }(_maxFee, _USDSAmount, _upperHint, _lowerHint, priceFeedUpdateData);
    }

    function claimSPRewardsAndRecycle(
        uint _maxFee, 
        address _upperHint, 
        address _lowerHint,
        bytes[] calldata priceFeedUpdateData
    ) external {
        uint collBalanceBefore = address(this).balance;
        uint sableBalanceBefore = sableToken.balanceOf(address(this));

        // Claim rewards
        stabilityPool.withdrawFromSP(0, priceFeedUpdateData);

        uint collBalanceAfter = address(this).balance;
        uint sableBalanceAfter = sableToken.balanceOf(address(this));
        uint claimedCollateral = collBalanceAfter.sub(collBalanceBefore);

        // Add claimed BNB to trove, get more USDS and stake it into the Stability Pool
        if (claimedCollateral > 0) {
            _requireUserHasTrove(address(this));
            uint USDSAmount = _getNetUSDSAmount(claimedCollateral, priceFeedUpdateData);
            IBorrowerOperations.AdjustTroveParam memory adjustParam = IBorrowerOperations.AdjustTroveParam({
                maxFeePercentage: _maxFee,
                upperHint: _upperHint,
                lowerHint: _lowerHint,
                USDSChange: USDSAmount,
                isDebtIncrease: true,
                collWithdrawal: 0
            });
            borrowerOperations.adjustTrove{ value: claimedCollateral }(
                adjustParam,
                priceFeedUpdateData
            );
            // Provide withdrawn USDS to Stability Pool
            if (USDSAmount > 0) {
                stabilityPool.provideToSP(USDSAmount, address(0));
            }
        }

        // Stake claimed SABLE
        uint claimedSABLE = sableBalanceAfter.sub(sableBalanceBefore);
        if (claimedSABLE > 0) {
            sableStaking.stake(claimedSABLE);
        }
    }

    function claimStakingGainsAndRecycle(
        uint _maxFee, 
        address _upperHint, 
        address _lowerHint,
        bytes[] calldata priceFeedUpdateData
    ) external payable {
        uint collBalanceBefore = address(this).balance;
        uint usdsBalanceBefore = usdsToken.balanceOf(address(this));
        uint sableBalanceBefore = sableToken.balanceOf(address(this));

        // Claim gains
        sableStaking.unstake(0);

        uint gainedCollateral = address(this).balance.sub(collBalanceBefore); // stack too deep issues :'(
        uint gainedUSDS = usdsToken.balanceOf(address(this)).sub(usdsBalanceBefore);

        uint netUSDSAmount;
        // Top up trove and get more USDS, keeping ICR constant
        if (gainedCollateral > 0) {
            _requireUserHasTrove(address(this));
            netUSDSAmount = _getNetUSDSAmount(gainedCollateral, priceFeedUpdateData);
            IBorrowerOperations.AdjustTroveParam memory adjustParam = IBorrowerOperations.AdjustTroveParam({
                maxFeePercentage: _maxFee,
                upperHint: _upperHint,
                lowerHint: _lowerHint,
                USDSChange: netUSDSAmount,
                isDebtIncrease: true,
                collWithdrawal: 0
            });
            borrowerOperations.adjustTrove{ value: gainedCollateral }(
                adjustParam,
                priceFeedUpdateData
            );
        }

        uint totalUSDS = gainedUSDS.add(netUSDSAmount);
        if (totalUSDS > 0) {
            stabilityPool.provideToSP(totalUSDS, address(0));

            // Providing to Stability Pool also triggers SABLE claim, so stake it if any
            uint sableBalanceAfter = sableToken.balanceOf(address(this));
            uint claimedSABLE = sableBalanceAfter.sub(sableBalanceBefore);
            if (claimedSABLE > 0) {
                sableStaking.stake(claimedSABLE);
            }
        }

    }

    function _getNetUSDSAmount(
        uint _collateral,
        bytes[] calldata priceFeedUpdateData
    ) internal returns (uint) {

        IPriceFeed.FetchPriceResult memory fetchPriceResult = priceFeed.fetchPrice(priceFeedUpdateData);

        // calculate oracleRate
        uint oracleRate = oracleRateCalc.getOracleRate(
            fetchPriceResult.oracleKey, 
            fetchPriceResult.deviationPyth, 
            fetchPriceResult.publishTimePyth
        );

        uint ICR = troveManager.getCurrentICR(address(this), fetchPriceResult.price);

        uint USDSAmount = _collateral.mul(fetchPriceResult.price).div(ICR);
        uint borrowingRate = troveManager.getBorrowingRateWithDecay(oracleRate);
        uint netDebt = USDSAmount.mul(LiquityMath.DECIMAL_PRECISION).div(LiquityMath.DECIMAL_PRECISION.add(borrowingRate));

        return netDebt;
    }

    function _requireUserHasTrove(address _depositor) internal view {
        require(troveManager.getTroveStatus(_depositor) == 1, "BorrowerWrappersScript: caller must have an active trove");
    }
}
