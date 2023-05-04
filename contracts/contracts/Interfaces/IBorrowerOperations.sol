// SPDX-License-Identifier: MIT

pragma solidity 0.6.11;
pragma experimental ABIEncoderV2;

import "./IActivePool.sol";
import "./ITroveManager.sol";

// Common interface for the Trove Manager.
interface IBorrowerOperations {
    // --- Events ---

    event TroveManagerAddressChanged(address _newTroveManagerAddress);
    event ActivePoolAddressChanged(address _activePoolAddress);
    event DefaultPoolAddressChanged(address _defaultPoolAddress);
    event StabilityPoolAddressChanged(address _stabilityPoolAddress);
    event GasPoolAddressChanged(address _gasPoolAddress);
    event CollSurplusPoolAddressChanged(address _collSurplusPoolAddress);
    event PriceFeedAddressChanged(address _newPriceFeedAddress);
    event SortedTrovesAddressChanged(address _sortedTrovesAddress);
    event LUSDTokenAddressChanged(address _lusdTokenAddress);
    event LQTYStakingAddressChanged(address _lqtyStakingAddress);
    event OracleRateCalcAddressChanged(address _oracleRateCalcAddress);

    event TroveCreated(address indexed _borrower, uint arrayIndex);
    event TroveUpdated(
        address indexed _borrower,
        uint _debt,
        uint _coll,
        uint stake,
        uint8 operation
    );
    event LUSDBorrowingFeePaid(address indexed _borrower, uint _LUSDFee);

    // --- Functions ---

    struct DependencyAddressParam {
        address troveManagerAddress;
        address activePoolAddress;
        address defaultPoolAddress;
        address stabilityPoolAddress;
        address gasPoolAddress;
        address collSurplusPoolAddress;
        address priceFeedAddress;
        address sortedTrovesAddress;
        address lusdTokenAddress;
        address lqtyStakingAddress;
        address systemStateAddress;
        address oracleRateCalcAddress;
    }

    struct TriggerBorrowingFeeParam {
        ITroveManager troveManager;
        ILUSDToken lusdToken;
        uint LUSDAmount;
        uint maxFeePercentage;
        uint oracleRate;
    }

    struct WithdrawLUSDParam {
        IActivePool activePool;
        ILUSDToken lusdToken;
        address account;
        uint LUSDAmount;
        uint netDebtIncrease;
    }

    struct TroveIsActiveParam {
        ITroveManager troveManager;
        address borrower;
    }

    function setAddresses(DependencyAddressParam memory param) external;

    function openTrove(
        uint _maxFee,
        uint _LUSDAmount,
        address _upperHint,
        address _lowerHint,
        bytes[] calldata priceFeedUpdatedata
    ) external payable;

    function addColl(
        address _upperHint, 
        address _lowerHint,
        bytes[] calldata priceFeedUpdatedata
    ) external payable;

    function moveETHGainToTrove(
        address _user,
        address _upperHint,
        address _lowerHint,
        bytes[] calldata priceFeedUpdatedata
    ) external payable;

    function withdrawColl(
        uint _amount, 
        address _upperHint, 
        address _lowerHint,
        bytes[] calldata priceFeedUpdatedata
    ) external;

    function withdrawLUSD(
        uint _maxFee,
        uint _amount,
        address _upperHint,
        address _lowerHint,
        bytes[] calldata priceFeedUpdatedata
    ) external;

    function repayLUSD(
        uint _amount, 
        address _upperHint, 
        address _lowerHint,
        bytes[] calldata priceFeedUpdatedata
    ) external;

    function closeTrove(bytes[] calldata priceFeedUpdatedata) external;

    struct AdjustTroveParam {
        uint collWithdrawal;
        uint LUSDChange;
        bool isDebtIncrease;
        address upperHint;
        address lowerHint;
        uint maxFeePercentage;
    }

    struct NewICRFromTroveChangeParam {
        uint coll;
        uint debt;
        uint collChange;
        bool isCollIncrease;
        uint debtChange;
        bool isDebtIncrease;
        uint price;
    }

    struct UpdateTroveFromAdjustmentParam {
        ITroveManager troveManager;
        address borrower;
        uint collChange;
        bool isCollIncrease;
        uint debtChange;
        bool isDebtIncrease;
    }

    struct NewNomialICRFromTroveChangeParam {
        uint coll;
        uint debt;
        uint collChange;
        bool isCollIncrease;
        uint debtChange;
        bool isDebtIncrease;
    }

    function adjustTrove(
        AdjustTroveParam memory adjustParam,
        bytes[] calldata priceFeedUpdateData
    ) external payable;

    function claimCollateral() external;

    function getCompositeDebt(uint _debt) external view returns (uint);
}
