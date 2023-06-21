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
    event USDSTokenAddressChanged(address _usdsTokenAddress);
    event SableStakingAddressChanged(address _sableStakingAddress);
    event OracleRateCalcAddressChanged(address _oracleRateCalcAddress);

    event TroveCreated(address indexed _borrower, uint arrayIndex);
    event TroveUpdated(
        address indexed _borrower,
        uint _debt,
        uint _coll,
        uint stake,
        uint8 operation
    );
    event USDSBorrowingFeePaid(address indexed _borrower, uint _USDSFee);

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
        address usdsTokenAddress;
        address sableStakingAddress;
        address systemStateAddress;
        address oracleRateCalcAddress;
    }

    struct TriggerBorrowingFeeParam {
        ITroveManager troveManager;
        IUSDSToken usdsToken;
        uint USDSAmount;
        uint maxFeePercentage;
        uint oracleRate;
    }

    struct WithdrawUSDSParam {
        IActivePool activePool;
        IUSDSToken usdsToken;
        address account;
        uint USDSAmount;
        uint netDebtIncrease;
    }

    struct TroveIsActiveParam {
        ITroveManager troveManager;
        address borrower;
    }

    function setAddresses(DependencyAddressParam memory param) external;

    function openTrove(
        uint _maxFee,
        uint _USDSAmount,
        address _upperHint,
        address _lowerHint,
        bytes[] calldata priceFeedUpdatedata
    ) external payable;

    function addColl(
        address _upperHint, 
        address _lowerHint,
        bytes[] calldata priceFeedUpdatedata
    ) external payable;

    function moveBNBGainToTrove(
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

    function withdrawUSDS(
        uint _maxFee,
        uint _amount,
        address _upperHint,
        address _lowerHint,
        bytes[] calldata priceFeedUpdatedata
    ) external;

    function repayUSDS(
        uint _amount, 
        address _upperHint, 
        address _lowerHint,
        bytes[] calldata priceFeedUpdatedata
    ) external;

    function closeTrove(bytes[] calldata priceFeedUpdatedata) external;

    struct AdjustTroveParam {
        uint collWithdrawal;
        uint USDSChange;
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
