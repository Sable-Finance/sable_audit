// SPDX-License-Identifier: MIT

pragma solidity 0.6.11;
pragma experimental ABIEncoderV2;

import "./ILiquityBase.sol";
import "./IStabilityPool.sol";
import "./IUSDSToken.sol";
import "./ISABLEToken.sol";
import "./ISABLEStaking.sol";
import "./IOracleRateCalculation.sol";
import "./ICollSurplusPool.sol";
import "./ISortedTroves.sol";
import "./ITroveHelper.sol";
import "../Dependencies/LiquityBase.sol";
import "../Dependencies/Ownable.sol";
import "../Dependencies/CheckContract.sol";

// Common interface for the Trove Manager.
interface ITroveManager is ILiquityBase {
    // --- Events ---
    event AddressesChanged(DependencyAddressParam param);

    event Liquidation(
        uint _liquidatedDebt,
        uint _liquidatedColl,
        uint _collGasCompensation,
        uint _USDSGasCompensation
    );
    event Redemption(uint _attemptedUSDSAmount, uint _actualUSDSAmount, uint _BNBSent, uint _BNBFee);
    event TroveUpdated(
        address indexed _borrower,
        uint _debt,
        uint _coll,
        uint _stake,
        TroveManagerOperation _operation
    );
    event TroveLiquidated(
        address indexed _borrower,
        uint _debt,
        uint _coll,
        TroveManagerOperation _operation
    );
    event BaseRateUpdated(uint _baseRate);
    event LastFeeOpTimeUpdated(uint _lastFeeOpTime);
    event TotalStakesUpdated(uint _newTotalStakes);
    event SystemSnapshotsUpdated(uint _totalStakesSnapshot, uint _totalCollateralSnapshot);
    event LTermsUpdated(uint _L_BNB, uint _L_USDSDebt);
    event TroveSnapshotsUpdated(uint _L_BNB, uint _L_USDSDebt);
    event TroveIndexUpdated(address _borrower, uint _newIndex);

    enum TroveManagerOperation {
        applyPendingRewards,
        liquidateInNormalMode,
        liquidateInRecoveryMode,
        redeemCollateral
    }

    enum Status {
        nonExistent,
        active,
        closedByOwner,
        closedByLiquidation,
        closedByRedemption
    }

    // Store the necessary data for a trove
    struct Trove {
        uint debt;
        uint coll;
        uint stake;
        Status status;
        uint128 arrayIndex;
    }

    // Object containing the BNB and USDS snapshots for a given active trove
    struct RewardSnapshot {
        uint BNB;
        uint USDSDebt;
    }

    /*
     * --- Variable container structs for liquidations ---
     *
     * These structs are used to hold, return and assign variables inside the liquidation functions,
     * in order to avoid the error: "CompilerError: Stack too deep".
     **/

    struct LocalVariables_OuterLiquidationFunction {
        uint price;
        uint USDSInStabPool;
        bool recoveryModeAtStart;
        uint liquidatedDebt;
        uint liquidatedColl;
    }

    struct LocalVariables_InnerSingleLiquidateFunction {
        uint collToLiquidate;
        uint pendingDebtReward;
        uint pendingCollReward;
    }

    struct LocalVariables_LiquidationSequence {
        uint remainingUSDSInStabPool;
        uint i;
        uint ICR;
        address user;
        address firstUser;
        bool backToNormalMode;
        uint entireSystemDebt;
        uint entireSystemColl;
        uint MCR;
    }

    struct LiquidationValues {
        uint entireTroveDebt;
        uint entireTroveColl;
        uint collGasCompensation;
        uint USDSGasCompensation;
        uint debtToOffset;
        uint collToSendToSP;
        uint debtToRedistribute;
        uint collToRedistribute;
        uint collSurplus;
    }

    struct LiquidationTotals {
        uint totalCollInSequence;
        uint totalDebtInSequence;
        uint totalCollGasCompensation;
        uint totalUSDSGasCompensation;
        uint totalDebtToOffset;
        uint totalCollToSendToSP;
        uint totalDebtToRedistribute;
        uint totalCollToRedistribute;
        uint totalCollSurplus;
    }

    struct ContractsCache {
        IActivePool activePool;
        IDefaultPool defaultPool;
        IUSDSToken usdsToken;
        ISABLEStaking sableStaking;
        ISortedTroves sortedTroves;
        ICollSurplusPool collSurplusPool;
        address gasPoolAddress;
    }
    // --- Variable container structs for redemptions ---

    struct RedemptionTotals {
        uint remainingUSDS;
        uint totalUSDSToRedeem;
        uint totalBNBDrawn;
        uint BNBFee;
        uint BNBToSendToRedeemer;
        uint decayedBaseRate;
        uint price;
        uint totalUSDSSupplyAtStart;
    }

    struct SingleRedemptionValues {
        uint USDSLot;
        uint BNBLot;
        bool cancelledPartial;
    }

    // Struct to avoid stack too deep
    struct LocalVariables_RedeemCollateralFromTrove {
        uint usdsGasCompensation;
        uint minNetDebt;
        uint newDebt;
        uint newColl;
    }

    struct RedeemCollateralFromTroveParam {
        ContractsCache contractsCache;
        address borrower;
        uint maxUSDSamount;
        uint price;
        address upperPartialRedemptionHint;
        address lowerPartialRedemptionHint;
        uint partialRedemptionHintNICR;
    }
    
    struct DependencyAddressParam {
        address borrowerOperationsAddress;
        address activePoolAddress;
        address defaultPoolAddress;
        address stabilityPoolAddress;
        address gasPoolAddress;
        address collSurplusPoolAddress;
        address priceFeedAddress;
        address usdsTokenAddress;
        address sortedTrovesAddress;
        address sableTokenAddress;
        address sableStakingAddress;
        address systemStateAddress;
        address oracleRateCalcAddress;
        address troveHelperAddress;
    }

    // --- Functions ---

    function setAddresses(DependencyAddressParam memory param) external;

    function stabilityPool() external view returns (IStabilityPool);

    function usdsToken() external view returns (IUSDSToken);

    function sableToken() external view returns (ISABLEToken);

    function sableStaking() external view returns (ISABLEStaking);

    function oracleRateCalc() external view returns (IOracleRateCalculation);

    function getTroveOwnersCount() external view returns (uint);

    function getTroveFromTroveOwnersArray(uint _index) external view returns (address);

    function getNominalICR(address _borrower) external view returns (uint);

    function getCurrentICR(address _borrower, uint _price) external view returns (uint);

    function liquidate(
        address _borrower,
        bytes[] calldata priceFeedUpdateData
    ) external;

    function liquidateTroves(
        uint _n,
        bytes[] calldata priceFeedUpdateData
    ) external;

    function batchLiquidateTroves(
        address[] calldata _troveArray,
        bytes[] calldata priceFeedUpdateData    
    ) external;

    function redeemCollateral(
        uint _USDSAmount,
        address _firstRedemptionHint,
        address _upperPartialRedemptionHint,
        address _lowerPartialRedemptionHint,
        uint _partialRedemptionHintNICR,
        uint _maxIterations,
        uint _maxFee,
        bytes[] calldata priceFeedUpdateData
    ) external;

    function updateStakeAndTotalStakes(address _borrower) external returns (uint);

    function updateTroveRewardSnapshots(address _borrower) external;

    function addTroveOwnerToArray(address _borrower) external returns (uint index);

    function applyPendingRewards(address _borrower) external;

    function getPendingBNBReward(address _borrower) external view returns (uint);

    function getPendingUSDSDebtReward(address _borrower) external view returns (uint);

    function hasPendingRewards(address _borrower) external view returns (bool);

    function getEntireDebtAndColl(
        address _borrower
    )
        external
        view
        returns (uint debt, uint coll, uint pendingUSDSDebtReward, uint pendingBNBReward);

    function closeTrove(address _borrower) external;

    function removeStake(address _borrower) external;

    function getRedemptionRate(uint _oracleRate) external view returns (uint);

    function getRedemptionRateWithDecay(uint _oracleRate) external view returns (uint);

    function getRedemptionFeeWithDecay(uint _BNBDrawn, uint _oracleRate) external view returns (uint);

    function getBorrowingRate(uint _oracleRate) external view returns (uint);

    function getBorrowingRateWithDecay(uint _oracleRate) external view returns (uint);

    function getBorrowingFee(uint USDSDebt, uint _oracleRate) external view returns (uint);

    function getBorrowingFeeWithDecay(uint _USDSDebt, uint _oracleRate) external view returns (uint);

    function decayBaseRateFromBorrowing() external;

    function getTroveStatus(address _borrower) external view returns (uint);

    function getTroveStake(address _borrower) external view returns (uint);

    function getTroveDebt(address _borrower) external view returns (uint);

    function getTroveColl(address _borrower) external view returns (uint);

    function setTroveStatus(address _borrower, uint num) external;

    function increaseTroveColl(address _borrower, uint _collIncrease) external returns (uint);

    function decreaseTroveColl(address _borrower, uint _collDecrease) external returns (uint);

    function increaseTroveDebt(address _borrower, uint _debtIncrease) external returns (uint);

    function decreaseTroveDebt(address _borrower, uint _collDecrease) external returns (uint);

    function getTCR(uint _price) external view returns (uint);

    function checkRecoveryMode(uint _price) external view returns (bool);
}
