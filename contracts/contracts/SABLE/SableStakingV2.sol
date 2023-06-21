// SPDX-License-Identifier: MIT

pragma solidity 0.6.11;

import "../Dependencies/BaseMath.sol";
import "../Dependencies/SafeMath.sol";
import "../Dependencies/Ownable.sol";
import "../Dependencies/CheckContract.sol";
import "../Dependencies/console.sol";
import "../Interfaces/ISABLEToken.sol";
import "../Interfaces/ISableStakingV2.sol";
import "../Interfaces/ISableRewarder.sol";
import "../Dependencies/LiquityMath.sol";
import "../Interfaces/IUSDSToken.sol";
import "../Interfaces/ISableLPToken.sol";

contract SableStakingV2 is ISableStakingV2, Ownable, CheckContract, BaseMath {
    using SafeMath for uint;

    // --- Data ---
    string constant public NAME = "SableStaking";

    mapping(address => uint) public stakes;
    uint public totalSableLPStaked;

    uint public F_BNB;  // Running sum of BNB fees per-SABLE-staked
    uint public F_USDS; // Running sum of USDS fees per-SABLE-staked
    uint public F_SABLE; // Running sum of SABLE gains per-SABLE-staked

    // User snapshots of F_BNB, F_USDS and F_SABLE, taken at the point at which their latest deposit was made
    mapping (address => Snapshot) public snapshots; 

    struct Snapshot {
        uint F_BNB_Snapshot;
        uint F_USDS_Snapshot;
        uint F_SABLE_Snapshot;
    }
    
    ISABLEToken public sableToken;
    IUSDSToken public usdsToken;
    ISableLPToken public sableLPToken;
    ISableRewarder public sableRewarder;

    address public troveManagerAddress;
    address public borrowerOperationsAddress;
    address public sableRewarderAddress;
    address public activePoolAddress;

    bool public initialized;

    // --- Events ---

    event SABLETokenAddressSet(address _sableTokenAddress);
    event USDSTokenAddressSet(address _usdsTokenAddress);
    event TroveManagerAddressSet(address _troveManager);
    event BorrowerOperationsAddressSet(address _borrowerOperationsAddress);
    event SableRewarderAddressSet(address _sableRewarderAddress);
    event ActivePoolAddressSet(address _activePoolAddress);

    event StakeChanged(address indexed staker, uint newStake);
    event StakingGainsWithdrawn(address indexed staker, uint USDSGain, uint BNBGain, uint SABLEGain);
    event F_BNBUpdated(uint _F_BNB);
    event F_USDSUpdated(uint _F_USDS);
    event F_SABLEUpdated(uint _F_SABLE);
    event TotalSableLPStakedUpdated(uint _totalSableLPStaked);
    event EtherSent(address _account, uint _amount);
    event StakerSnapshotsUpdated(address _staker, uint _F_BNB, uint _F_USDS, uint _F_SABLE);

    event SableLPTokenAddressSet(address _sableLPTokenAddress);

    // --- Functions ---

    function setAddresses
    (
        address _sableTokenAddress,
        address _usdsTokenAddress,
        address _troveManagerAddress, 
        address _borrowerOperationsAddress,
        address _sableRewarderAddress,
        address _activePoolAddress
    ) 
        external 
        onlyOwner 
        override 
    {
        checkContract(_sableTokenAddress);
        checkContract(_usdsTokenAddress);
        checkContract(_troveManagerAddress);
        checkContract(_borrowerOperationsAddress);
        checkContract(_sableRewarderAddress);
        checkContract(_activePoolAddress);

        sableToken = ISABLEToken(_sableTokenAddress);
        usdsToken = IUSDSToken(_usdsTokenAddress);
        sableRewarder = ISableRewarder(_sableRewarderAddress);
        troveManagerAddress = _troveManagerAddress;
        borrowerOperationsAddress = _borrowerOperationsAddress;
        sableRewarderAddress = _sableRewarderAddress;
        activePoolAddress = _activePoolAddress;

        emit SABLETokenAddressSet(_sableTokenAddress);
        emit USDSTokenAddressSet(_usdsTokenAddress);
        emit TroveManagerAddressSet(_troveManagerAddress);
        emit BorrowerOperationsAddressSet(_borrowerOperationsAddress);
        emit SableRewarderAddressSet(_sableRewarderAddress);
        emit ActivePoolAddressSet(_activePoolAddress);
    }

    function setSableLPAddress(address _sableLPTokenAddress) external onlyOwner override {
        checkContract(_sableLPTokenAddress);
        sableLPToken = ISableLPToken(_sableLPTokenAddress);
        
        emit SableLPTokenAddressSet(_sableLPTokenAddress);

        initialized = true;
    }

    function renounceOwnership() external onlyOwner {
        _renounceOwnership();
    }

    // If caller has a pre-existing stake, send any accumulated BNB, USDS and SABLE to them. 
    function stake(uint _sableLPAmount) external override {
        _requireInitialized();
        _requireNonZeroAmount(_sableLPAmount);

        sableRewarder.issueSABLE();

        uint currentStake = stakes[msg.sender];

        uint BNBGain;
        uint USDSGain;
        uint SABLEGain;
        // Grab any accumulated BNB, USDS and SABLE from the current stake
        if (currentStake != 0) {
            BNBGain = _getPendingBNBGain(msg.sender);
            USDSGain = _getPendingUSDSGain(msg.sender);
            SABLEGain = _getPendingSABLEGain(msg.sender);
        }
    
        _updateUserSnapshots(msg.sender);

        uint newStake = currentStake.add(_sableLPAmount);

        // Increase user’s stake and total SABLE staked
        stakes[msg.sender] = newStake;
        totalSableLPStaked = totalSableLPStaked.add(_sableLPAmount);
        emit TotalSableLPStakedUpdated(totalSableLPStaked);

        // Transfer SABLE from caller to this contract
        sableLPToken.transferFrom(msg.sender, address(this), _sableLPAmount);

        emit StakeChanged(msg.sender, newStake);
        emit StakingGainsWithdrawn(msg.sender, USDSGain, BNBGain, SABLEGain);

         // Send accumulated BNB, USDS and SABLE to the caller
        if (currentStake != 0) {
            usdsToken.transfer(msg.sender, USDSGain);
            sableToken.transfer(msg.sender, SABLEGain);
            _sendBNBGainToUser(BNBGain);
        }
    }

    // Unstake the SABLE and send the it back to the caller, along with their accumulated BNB, USDS & SABLE. 
    // If requested amount > stake, send their entire stake.
    function unstake(uint _sableLPAmount) external override {
        _requireInitialized();
        
        sableRewarder.issueSABLE();
        
        uint currentStake = stakes[msg.sender];
        _requireUserHasStake(currentStake);

        // Grab any accumulated BNB, USDS and SABLE from the current stake
        uint BNBGain = _getPendingBNBGain(msg.sender);
        uint USDSGain = _getPendingUSDSGain(msg.sender);
        uint SABLEGain  = _getPendingSABLEGain(msg.sender);
        
        _updateUserSnapshots(msg.sender);

        if (_sableLPAmount > 0) {
            uint SableLPToWithdraw = LiquityMath._min(_sableLPAmount, currentStake);

            uint newStake = currentStake.sub(SableLPToWithdraw);

            // Decrease user's stake and total SABLE staked
            stakes[msg.sender] = newStake;
            totalSableLPStaked = totalSableLPStaked.sub(SableLPToWithdraw);
            emit TotalSableLPStakedUpdated(totalSableLPStaked);

            // Transfer unstaked SABLE to user
            sableLPToken.transfer(msg.sender, SableLPToWithdraw);

            emit StakeChanged(msg.sender, newStake);
        }

        emit StakingGainsWithdrawn(msg.sender, USDSGain, BNBGain, SABLEGain);

        // Send accumulated USDS, BNB and SABLE gains to the caller
        usdsToken.transfer(msg.sender, USDSGain);
        sableToken.transfer(msg.sender, SABLEGain);
        _sendBNBGainToUser(BNBGain);
    }

    // --- Reward-per-unit-staked increase functions. Called by Sable core contracts ---

    function increaseF_BNB(uint _BNBFee) external override {
        _requireCallerIsTroveManager();
        uint BNBFeePerSABLEStaked;
     
        if (totalSableLPStaked > 0) {BNBFeePerSABLEStaked = _BNBFee.mul(DECIMAL_PRECISION).div(totalSableLPStaked);}

        F_BNB = F_BNB.add(BNBFeePerSABLEStaked); 
        emit F_BNBUpdated(F_BNB);
    }

    function increaseF_USDS(uint _USDSFee) external override {
        _requireCallerIsBorrowerOperations();
        uint USDSFeePerSABLEStaked;
        
        if (totalSableLPStaked > 0) {USDSFeePerSABLEStaked = _USDSFee.mul(DECIMAL_PRECISION).div(totalSableLPStaked);}
        
        F_USDS = F_USDS.add(USDSFeePerSABLEStaked);
        emit F_USDSUpdated(F_USDS);
    }

    function increaseF_SABLE(uint _SABLEGain) external override {
        _requireCallerIsSableRewarder();
        uint SABLEGainPerSABLEStaked;
        
        if (totalSableLPStaked > 0) {SABLEGainPerSABLEStaked = _SABLEGain.mul(DECIMAL_PRECISION).div(totalSableLPStaked);}
        
        F_SABLE = F_SABLE.add(SABLEGainPerSABLEStaked);
        emit F_SABLEUpdated(F_SABLE);
    }

    // --- Pending reward functions ---

    function getPendingBNBGain(address _user) external view override returns (uint) {
        return _getPendingBNBGain(_user);
    }

    function _getPendingBNBGain(address _user) internal view returns (uint) {
        uint F_BNB_Snapshot = snapshots[_user].F_BNB_Snapshot;
        uint BNBGain = stakes[_user].mul(F_BNB.sub(F_BNB_Snapshot)).div(DECIMAL_PRECISION);
        return BNBGain;
    }

    function getPendingUSDSGain(address _user) external view override returns (uint) {
        return _getPendingUSDSGain(_user);
    }

    function _getPendingUSDSGain(address _user) internal view returns (uint) {
        uint F_USDS_Snapshot = snapshots[_user].F_USDS_Snapshot;
        uint USDSGain = stakes[_user].mul(F_USDS.sub(F_USDS_Snapshot)).div(DECIMAL_PRECISION);
        return USDSGain;
    }

    function getPendingSABLEGain(address _user) external view override returns (uint) {
        return _getPendingSABLEGain(_user);
    }

    function _getPendingSABLEGain(address _user) internal view returns (uint) {
        uint F_SABLE_Snapshot = snapshots[_user].F_SABLE_Snapshot;
        uint SABLEGain = stakes[_user].mul(F_SABLE.sub(F_SABLE_Snapshot)).div(DECIMAL_PRECISION);
        return SABLEGain;
    }

    // --- Internal helper functions ---

    function _updateUserSnapshots(address _user) internal {
        snapshots[_user].F_BNB_Snapshot = F_BNB;
        snapshots[_user].F_USDS_Snapshot = F_USDS;
        snapshots[_user].F_SABLE_Snapshot = F_SABLE;
        emit StakerSnapshotsUpdated(_user, F_BNB, F_USDS, F_SABLE);
    }

    function _sendBNBGainToUser(uint BNBGain) internal {
        emit EtherSent(msg.sender, BNBGain);
        (bool success, ) = msg.sender.call{value: BNBGain}("");
        require(success, "SableStaking: Failed to send accumulated BNBGain");
    }

    // --- 'require' functions ---

    function _requireCallerIsTroveManager() internal view {
        require(msg.sender == troveManagerAddress, "SableStaking: caller is not TroveM");
    }

    function _requireCallerIsBorrowerOperations() internal view {
        require(msg.sender == borrowerOperationsAddress, "SableStaking: caller is not BorrowerOps");
    }

    function _requireCallerIsSableRewarder() internal view {
        require(msg.sender == sableRewarderAddress, "SableStaking: caller is not SableRe");
    }

     function _requireCallerIsActivePool() internal view {
        require(msg.sender == activePoolAddress, "SableStaking: caller is not ActivePool");
    }

    function _requireUserHasStake(uint currentStake) internal pure {  
        require(currentStake > 0, "SableStaking: User must have a non-zero stake");  
    }

    function _requireNonZeroAmount(uint _amount) internal pure {
        require(_amount > 0, "SableStaking: Amount must be non-zero");
    }

    function _requireInitialized() internal view {
        require(initialized, "SableStaking: Staking not ready");
    }
    
    receive() external payable {
        _requireCallerIsActivePool();
    }
}
