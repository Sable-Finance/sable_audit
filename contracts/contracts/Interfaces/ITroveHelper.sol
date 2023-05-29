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
import "./ITroveManager.sol";
import "../Dependencies/LiquityBase.sol";
import "../Dependencies/Ownable.sol";
import "../Dependencies/CheckContract.sol";

// Common interface for the Trove Manager.
interface ITroveHelper {
    function setAddresses(
        address _troveManagerAddress,
        address _systemStateAddress,
        address _sortedTrovesAddress,
        address _sableTokenAddress,
        address _activePoolAddress,
        address _defaultPoolAddress
    ) external;

    function getCappedOffsetVals(
        uint _entireTroveDebt,
        uint _entireTroveColl,
        uint _price
    ) external view returns (ITroveManager.LiquidationValues memory singleLiquidation);

    function isValidFirstRedemptionHint(
        ISortedTroves _sortedTroves,
        address _firstRedemptionHint,
        uint _price
    ) external view returns (bool);

    function requireValidMaxFeePercentage(uint _maxFeePercentage) external view;

    function requireAfterBootstrapPeriod() external view;

    function requireUSDSBalanceCoversRedemption(
        IUSDSToken _usdsToken,
        address _redeemer,
        uint _amount
    ) external view;

    function requireMoreThanOneTroveInSystem(uint TroveOwnersArrayLength) external view;

    function requireAmountGreaterThanZero(uint _amount) external view;

    function requireTCRoverMCR(uint _price) external view;

    function checkPotentialRecoveryMode(
        uint _entireSystemColl,
        uint _entireSystemDebt,
        uint _price
    ) external view returns (bool);
}
