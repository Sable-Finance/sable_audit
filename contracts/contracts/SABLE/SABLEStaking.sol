// SPDX-License-Identifier: MIT

pragma solidity 0.6.11;

import "../Dependencies/BaseMath.sol";
import "../Dependencies/SafeMath.sol";
import "../Dependencies/Ownable.sol";
import "../Dependencies/CheckContract.sol";
import "../Dependencies/console.sol";
import "../Interfaces/ISABLEToken.sol";
import "../Interfaces/ISABLEStaking.sol";
import "../Dependencies/LiquityMath.sol";
import "../Interfaces/IUSDSToken.sol";

contract SABLEStaking is ISABLEStaking, Ownable, CheckContract, BaseMath {
    using SafeMath for uint;

    // --- Data ---
    string constant public NAME = "SABLEStaking";

    mapping( address => uint) public stakes;
    uint public totalSABLEStaked;

    uint public F_BNB;  // Running sum of BNB fees per-SABLE-staked
    uint public F_USDS; // Running sum of SABLE fees per-SABLE-staked

    // User snapshots of F_BNB and F_USDS, taken at the point at which their latest deposit was made
    mapping (address => Snapshot) public snapshots; 

    struct Snapshot {
        uint F_BNB_Snapshot;
        uint F_USDS_Snapshot;
    }
    
    ISABLEToken public sableToken;
    IUSDSToken public usdsToken;

    address public troveManagerAddress;
    address public borrowerOperationsAddress;
    address public activePoolAddress;

    // --- Events ---

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
    ) 
        external 
        onlyOwner 
        override 
    {
        checkContract(_sableTokenAddress);
        checkContract(_usdsTokenAddress);
        checkContract(_troveManagerAddress);
        checkContract(_borrowerOperationsAddress);
        checkContract(_activePoolAddress);

        sableToken = ISABLEToken(_sableTokenAddress);
        usdsToken = IUSDSToken(_usdsTokenAddress);
        troveManagerAddress = _troveManagerAddress;
        borrowerOperationsAddress = _borrowerOperationsAddress;
        activePoolAddress = _activePoolAddress;

        emit SABLETokenAddressSet(_sableTokenAddress);
        emit SABLETokenAddressSet(_usdsTokenAddress);
        emit TroveManagerAddressSet(_troveManagerAddress);
        emit BorrowerOperationsAddressSet(_borrowerOperationsAddress);
        emit ActivePoolAddressSet(_activePoolAddress);

        _renounceOwnership();
    }

    // If caller has a pre-existing stake, send any accumulated BNB and USDS gains to them. 
    function stake(uint _SABLEamount) external override {
        _requireNonZeroAmount(_SABLEamount);

        uint currentStake = stakes[msg.sender];

        uint BNBGain;
        uint USDSGain;
        // Grab any accumulated BNB and USDS gains from the current stake
        if (currentStake != 0) {
            BNBGain = _getPendingBNBGain(msg.sender);
            USDSGain = _getPendingUSDSGain(msg.sender);
        }
    
       _updateUserSnapshots(msg.sender);

        uint newStake = currentStake.add(_SABLEamount);

        // Increase user’s stake and total SABLE staked
        stakes[msg.sender] = newStake;
        totalSABLEStaked = totalSABLEStaked.add(_SABLEamount);
        emit TotalSABLEStakedUpdated(totalSABLEStaked);

        // Transfer SABLE from caller to this contract
        sableToken.sendToSABLEStaking(msg.sender, _SABLEamount);

        emit StakeChanged(msg.sender, newStake);
        emit StakingGainsWithdrawn(msg.sender, USDSGain, BNBGain);

         // Send accumulated USDS and BNB gains to the caller
        if (currentStake != 0) {
            usdsToken.transfer(msg.sender, USDSGain);
            _sendBNBGainToUser(BNBGain);
        }
    }

    // Unstake the SABLE and send the it back to the caller, along with their accumulated USDS & BNB gains. 
    // If requested amount > stake, send their entire stake.
    function unstake(uint _SABLEamount) external override {
        uint currentStake = stakes[msg.sender];
        _requireUserHasStake(currentStake);

        // Grab any accumulated BNB and USDS gains from the current stake
        uint BNBGain = _getPendingBNBGain(msg.sender);
        uint USDSGain = _getPendingUSDSGain(msg.sender);
        
        _updateUserSnapshots(msg.sender);

        if (_SABLEamount > 0) {
            uint SABLEToWithdraw = LiquityMath._min(_SABLEamount, currentStake);

            uint newStake = currentStake.sub(SABLEToWithdraw);

            // Decrease user's stake and total SABLE staked
            stakes[msg.sender] = newStake;
            totalSABLEStaked = totalSABLEStaked.sub(SABLEToWithdraw);
            emit TotalSABLEStakedUpdated(totalSABLEStaked);

            // Transfer unstaked SABLE to user
            sableToken.transfer(msg.sender, SABLEToWithdraw);

            emit StakeChanged(msg.sender, newStake);
        }

        emit StakingGainsWithdrawn(msg.sender, USDSGain, BNBGain);

        // Send accumulated USDS and BNB gains to the caller
        usdsToken.transfer(msg.sender, USDSGain);
        _sendBNBGainToUser(BNBGain);
    }

    // --- Reward-per-unit-staked increase functions. Called by Liquity core contracts ---

    function increaseF_BNB(uint _BNBFee) external override {
        _requireCallerIsTroveManager();
        uint BNBFeePerSABLEStaked;
     
        if (totalSABLEStaked > 0) {BNBFeePerSABLEStaked = _BNBFee.mul(DECIMAL_PRECISION).div(totalSABLEStaked);}

        F_BNB = F_BNB.add(BNBFeePerSABLEStaked); 
        emit F_BNBUpdated(F_BNB);
    }

    function increaseF_USDS(uint _USDSFee) external override {
        _requireCallerIsBorrowerOperations();
        uint USDSFeePerSABLEStaked;
        
        if (totalSABLEStaked > 0) {USDSFeePerSABLEStaked = _USDSFee.mul(DECIMAL_PRECISION).div(totalSABLEStaked);}
        
        F_USDS = F_USDS.add(USDSFeePerSABLEStaked);
        emit F_USDSUpdated(F_USDS);
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

    // --- Internal helper functions ---

    function _updateUserSnapshots(address _user) internal {
        snapshots[_user].F_BNB_Snapshot = F_BNB;
        snapshots[_user].F_USDS_Snapshot = F_USDS;
        emit StakerSnapshotsUpdated(_user, F_BNB, F_USDS);
    }

    function _sendBNBGainToUser(uint BNBGain) internal {
        emit EtherSent(msg.sender, BNBGain);
        (bool success, ) = msg.sender.call{value: BNBGain}("");
        require(success, "SABLEStaking: Failed to send accumulated BNBGain");
    }

    // --- 'require' functions ---

    function _requireCallerIsTroveManager() internal view {
        require(msg.sender == troveManagerAddress, "SABLEStaking: caller is not TroveM");
    }

    function _requireCallerIsBorrowerOperations() internal view {
        require(msg.sender == borrowerOperationsAddress, "SABLEStaking: caller is not BorrowerOps");
    }

     function _requireCallerIsActivePool() internal view {
        require(msg.sender == activePoolAddress, "SABLEStaking: caller is not ActivePool");
    }

    function _requireUserHasStake(uint currentStake) internal pure {  
        require(currentStake > 0, 'SABLEStaking: User must have a non-zero stake');  
    }

    function _requireNonZeroAmount(uint _amount) internal pure {
        require(_amount > 0, 'SABLEStaking: Amount must be non-zero');
    }

    receive() external payable {
        _requireCallerIsActivePool();
    }
}
