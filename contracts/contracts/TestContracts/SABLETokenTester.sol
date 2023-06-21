// SPDX-License-Identifier: MIT

pragma solidity 0.6.11;

import "../SABLE/SABLEToken.sol";

contract SABLETokenTester is SABLEToken {
    constructor(
        address _sableStakingAddress,
        address _sableRewarderAddress,
        address _vaultAddress,
        uint256 _mintAmount
    ) public SABLEToken(_sableStakingAddress, _sableRewarderAddress, _vaultAddress, _mintAmount) {}

    function unprotectedMint(address account, uint256 amount) external {
        // No check for the caller here

        _mint(account, amount);
    }

    function unprotectedSendToSABLEStaking(address _sender, uint256 _amount) external {
        // No check for the caller here
        _transfer(_sender, sableStakingAddress, _amount);
    }

    function callInternalApprove(
        address owner,
        address spender,
        uint256 amount
    ) external returns (bool) {
        _approve(owner, spender, amount);
    }

    function callInternalTransfer(
        address sender,
        address recipient,
        uint256 amount
    ) external returns (bool) {
        _transfer(sender, recipient, amount);
    }

    function getChainId() external pure returns (uint256 chainID) {
        //return _chainID(); // it’s private
        assembly {
            chainID := chainid()
        }
    }
}
