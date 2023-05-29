// SPDX-License-Identifier: MIT

pragma solidity 0.6.11;

interface ISABLEStaking {

    // --- Events --
    
    event SABLETokenAddressSet(address _sableTokenAddress);
    event USDSTokenAddressSet(address _usdsTokenAddress);
    event TroveManagerAddressSet(address _troveManager);
    event BorrowerOperationsAddressSet(address _borrowerOperationsAddress);
    event ActivePoolAddressSet(address _activePoolAddress);

    event StakeChanged(address indexed staker, uint newStake);
    event StakingGainsWithdrawn(address indexed staker, uint USDSGain, uint BNBGain);
    event F_BNBUpdated(uint _F_BNB);
    event F_USDSUpdated(uint _F_USDS);
    event TotalSABLEStakedUpdated(uint _totalSABLEStaked);
    event EtherSent(address _account, uint _amount);
    event StakerSnapshotsUpdated(address _staker, uint _F_BNB, uint _F_USDS);

    // --- Functions ---

    function setAddresses
    (
        address _sableTokenAddress,
        address _usdsTokenAddress,
        address _troveManagerAddress, 
        address _borrowerOperationsAddress,
        address _activePoolAddress
    )  external;

    function stake(uint _SABLEamount) external;

    function unstake(uint _SABLEamount) external;

    function increaseF_BNB(uint _BNBFee) external; 

    function increaseF_USDS(uint _SABLEFee) external;  

    function getPendingBNBGain(address _user) external view returns (uint);

    function getPendingUSDSGain(address _user) external view returns (uint);
}
