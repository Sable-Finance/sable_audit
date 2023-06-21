// SPDX-License-Identifier: MIT

pragma solidity 0.6.11;

interface ISableRewarder { 
    
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

    function issueSABLE() external;

    function balanceSABLE() external returns (uint);

    function updateRewardPerSec(uint _newRewardPerSec) external;

    function transferOwnership(address _newOwner) external;
}
