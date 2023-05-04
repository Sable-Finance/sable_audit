// SPDX-License-Identifier: MIT

pragma solidity 0.6.11;
pragma experimental ABIEncoderV2;

import "../Dependencies/CheckContract.sol";
import "../Interfaces/IBorrowerOperations.sol";


contract BorrowerOperationsScript is CheckContract {
    IBorrowerOperations immutable borrowerOperations;

    constructor(IBorrowerOperations _borrowerOperations) public {
        checkContract(address(_borrowerOperations));
        borrowerOperations = _borrowerOperations;
    }

    function openTrove(
        uint _maxFee, 
        uint _LUSDAmount, 
        address _upperHint, 
        address _lowerHint,
        bytes[] calldata priceFeedUpdateData
    ) external payable {
        borrowerOperations.openTrove{ value: msg.value }(_maxFee, _LUSDAmount, _upperHint, _lowerHint, priceFeedUpdateData);
    }

    function addColl(
        address _upperHint, 
        address _lowerHint,
        bytes[] calldata priceFeedUpdateData
    ) external payable {
        borrowerOperations.addColl{ value: msg.value }(_upperHint, _lowerHint, priceFeedUpdateData);
    }

    function withdrawColl(
        uint _amount, 
        address _upperHint, 
        address _lowerHint,
        bytes[] calldata priceFeedUpdateData
    ) external {
        borrowerOperations.withdrawColl(_amount, _upperHint, _lowerHint, priceFeedUpdateData);
    }

    function withdrawLUSD(
        uint _maxFee, 
        uint _amount, 
        address _upperHint, 
        address _lowerHint,
        bytes[] calldata priceFeedUpdateData
    ) external {
        borrowerOperations.withdrawLUSD(_maxFee, _amount, _upperHint, _lowerHint, priceFeedUpdateData);
    }

    function repayLUSD(
        uint _amount, 
        address _upperHint, 
        address _lowerHint,
        bytes[] calldata priceFeedUpdateData
    ) external {
        borrowerOperations.repayLUSD(_amount, _upperHint, _lowerHint, priceFeedUpdateData);
    }

    function closeTrove(bytes[] calldata priceFeedUpdateData) external {
        borrowerOperations.closeTrove(priceFeedUpdateData);
    }

    function adjustTrove(
        IBorrowerOperations.AdjustTroveParam memory adjustParam,
        bytes[] calldata priceFeedUpdateData
    ) external payable {
        borrowerOperations.adjustTrove{ value: msg.value }(
            adjustParam, 
            priceFeedUpdateData
        );
    }

    function claimCollateral() external {
        borrowerOperations.claimCollateral();
    }
}