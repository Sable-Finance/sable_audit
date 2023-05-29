// SPDX-License-Identifier: MIT

pragma solidity 0.6.11;

interface ICommunityIssuance { 
    
    // --- Events ---
    
    event SABLETokenAddressSet(address _sableTokenAddress);
    event StabilityPoolAddressSet(address _stabilityPoolAddress);
    event RewardPerSecUpdated(uint256 _newRewardPerSec);

    // --- Functions ---

    function setParams
    (
        address _sableTokenAddress, 
        address _stabilityPoolAddress,
        uint256 _latestRewardPerSec
    ) external;

    function issueSABLE() external returns (uint);

    function sendSABLE(address _account, uint _SABLEamount) external;

    function balanceSABLE() external returns (uint);

    function updateRewardPerSec(uint _newRewardPerSec) external;
}
