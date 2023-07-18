// SPDX-License-Identifier: MIT

pragma solidity 0.6.11;
pragma experimental ABIEncoderV2;

import "../BorrowerOperations.sol";

/* Tester contract inherits from BorrowerOperations, and provides external functions 
for testing the parent's internal functions. */
contract BorrowerOperationsTester is BorrowerOperations {

    function getNewICRFromTroveChange
    (
        uint _coll, 
        uint _debt, 
        uint _collChange, 
        bool isCollIncrease, 
        uint _debtChange, 
        bool isDebtIncrease, 
        uint _price
    ) 
    external
    pure
    returns (uint)
    {
        NewICRFromTroveChangeParam memory newICRParam = NewICRFromTroveChangeParam({
            coll: _coll,
            debt: _debt,
            collChange: _collChange,
            isCollIncrease: isCollIncrease,
            debtChange: _debtChange,
            isDebtIncrease: isDebtIncrease,
            price: _price
        });
        return _getNewICRFromTroveChange(newICRParam);
    }

    function getNewTCRFromTroveChange
    (
        uint _collChange, 
        bool isCollIncrease,  
        uint _debtChange, 
        bool isDebtIncrease, 
        uint _price
    ) 
    external 
    view
    returns (uint) 
    {
        return _getNewTCRFromTroveChange(_collChange, isCollIncrease, _debtChange, isDebtIncrease, _price);
    }

    function getUSDValue(uint _coll, uint _price) external pure returns (uint) {
        return _getUSDValue(_coll, _price);
    }

    function callInternalAdjustLoan(
        address _borrower, 
        address _upperHint,
        address _lowerHint,
        bytes[] calldata priceFeedUpdateData
    ) external payable {
        AdjustTroveParam memory adjustTroveParam = AdjustTroveParam({
            collWithdrawal: 1e18,
            USDSChange: 1e18,
            isDebtIncrease: true,
            upperHint: _upperHint,
            lowerHint: _lowerHint,
            maxFeePercentage: 5e15
        });
        _adjustTrove(_borrower, adjustTroveParam, priceFeedUpdateData);
    }


    // Payable fallback function
    receive() external payable { }
}
