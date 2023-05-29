// SPDX-License-Identifier: MIT

pragma solidity 0.6.11;

import "../Interfaces/IUSDSToken.sol";

contract USDSTokenCaller {
    IUSDSToken USDS;

    function setUSDS(IUSDSToken _USDS) external {
        USDS = _USDS;
    }

    function usdsMint(address _account, uint _amount) external {
        USDS.mint(_account, _amount);
    }

    function usdsBurn(address _account, uint _amount) external {
        USDS.burn(_account, _amount);
    }

    function usdsSendToPool(address _sender,  address _poolAddress, uint256 _amount) external {
        USDS.sendToPool(_sender, _poolAddress, _amount);
    }

    function usdsReturnFromPool(address _poolAddress, address _receiver, uint256 _amount ) external {
        USDS.returnFromPool(_poolAddress, _receiver, _amount);
    }
}
