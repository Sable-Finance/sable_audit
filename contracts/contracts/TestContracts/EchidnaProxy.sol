// SPDX-License-Identifier: MIT

pragma solidity 0.6.11;
pragma experimental ABIEncoderV2;

import "../TroveManager.sol";
import "../BorrowerOperations.sol";
import "../StabilityPool.sol";
import "../USDSToken.sol";

contract EchidnaProxy {
    TroveManager troveManager;
    BorrowerOperations borrowerOperations;
    StabilityPool stabilityPool;
    USDSToken usdsToken;

    constructor(
        TroveManager _troveManager,
        BorrowerOperations _borrowerOperations,
        StabilityPool _stabilityPool,
        USDSToken _usdsToken
    ) public {
        troveManager = _troveManager;
        borrowerOperations = _borrowerOperations;
        stabilityPool = _stabilityPool;
        usdsToken = _usdsToken;
    }

    receive() external payable {
        // do nothing
    }

    // TroveManager

    function liquidatePrx(
        address _user,
        bytes[] calldata priceFeedUpdateData
    ) external {
        troveManager.liquidate(_user, priceFeedUpdateData);
    }

    function liquidateTrovesPrx(
        uint _n,
        bytes[] calldata priceFeedUpdateData
    ) external {
        troveManager.liquidateTroves(_n, priceFeedUpdateData);
    }

    function batchLiquidateTrovesPrx(
        address[] calldata _troveArray,
        bytes[] calldata priceFeedUpdateData
    ) external {
        troveManager.batchLiquidateTroves(_troveArray, priceFeedUpdateData);
    }

    function redeemCollateralPrx(
        uint _USDSAmount,
        address _firstRedemptionHint,
        address _upperPartialRedemptionHint,
        address _lowerPartialRedemptionHint,
        uint _partialRedemptionHintNICR,
        uint _maxIterations,
        uint _maxFee,
        bytes[] calldata priceFeedUpdateData
    ) external {
        troveManager.redeemCollateral(_USDSAmount, _firstRedemptionHint, _upperPartialRedemptionHint, _lowerPartialRedemptionHint, _partialRedemptionHintNICR, _maxIterations, _maxFee, priceFeedUpdateData);
    }

    // Borrower Operations
    function openTrovePrx(
        uint _BNB, 
        uint _USDSAmount, 
        address _upperHint, 
        address _lowerHint, 
        uint _maxFee,
        bytes[] calldata priceFeedUpdateData
    ) external payable {
        borrowerOperations.openTrove{value: _BNB}(_maxFee, _USDSAmount, _upperHint, _lowerHint, priceFeedUpdateData);
    }

    function addCollPrx(
        uint _BNB, 
        address _upperHint, 
        address _lowerHint,
        bytes[] calldata priceFeedUpdateData
    ) external payable {
        borrowerOperations.addColl{value: _BNB}(_upperHint, _lowerHint, priceFeedUpdateData);
    }

    function withdrawCollPrx(
        uint _amount, 
        address _upperHint, 
        address _lowerHint,
        bytes[] calldata priceFeedUpdateData
    ) external {
        borrowerOperations.withdrawColl(_amount, _upperHint, _lowerHint, priceFeedUpdateData);
    }

    function withdrawUSDSPrx(
        uint _amount, 
        address _upperHint, 
        address _lowerHint, 
        uint _maxFee,
        bytes[] calldata priceFeedUpdateData
    ) external {
        borrowerOperations.withdrawUSDS(_maxFee, _amount, _upperHint, _lowerHint, priceFeedUpdateData);
    }

    function repayUSDSPrx(
        uint _amount, 
        address _upperHint, 
        address _lowerHint,
        bytes[] calldata priceFeedUpdateData
    ) external {
        borrowerOperations.repayUSDS(_amount, _upperHint, _lowerHint, priceFeedUpdateData);
    }

    function closeTrovePrx(bytes[] calldata priceFeedUpdateData) external {
        borrowerOperations.closeTrove(priceFeedUpdateData);
    }

    function adjustTrovePrx(
        uint _BNB, 
        IBorrowerOperations.AdjustTroveParam memory adjustParam,
        bytes[] calldata priceFeedUpdateData
    ) external payable {
        borrowerOperations.adjustTrove{value: _BNB}(adjustParam, priceFeedUpdateData);
    }

    // Pool Manager
    function provideToSPPrx(uint _amount, address _frontEndTag) external {
        stabilityPool.provideToSP(_amount, _frontEndTag);
    }

    function withdrawFromSPPrx(
        uint _amount,
        bytes[] calldata priceFeedUpdateData
    ) external {
        stabilityPool.withdrawFromSP(_amount, priceFeedUpdateData);
    }

    // USDS Token

    function transferPrx(address recipient, uint256 amount) external returns (bool) {
        return usdsToken.transfer(recipient, amount);
    }

    function approvePrx(address spender, uint256 amount) external returns (bool) {
        return usdsToken.approve(spender, amount);
    }

    function transferFromPrx(address sender, address recipient, uint256 amount) external returns (bool) {
        return usdsToken.transferFrom(sender, recipient, amount);
    }

    function increaseAllowancePrx(address spender, uint256 addedValue) external returns (bool) {
        return usdsToken.increaseAllowance(spender, addedValue);
    }

    function decreaseAllowancePrx(address spender, uint256 subtractedValue) external returns (bool) {
        return usdsToken.decreaseAllowance(spender, subtractedValue);
    }
}
