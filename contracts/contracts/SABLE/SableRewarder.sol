// SPDX-License-Identifier: MIT

pragma solidity 0.6.11;

import "../Interfaces/ISABLEToken.sol";
import "../Interfaces/ISableRewarder.sol";
import "../Interfaces/ISableStakingV2.sol";
import "../Dependencies/BaseMath.sol";
import "../Dependencies/LiquityMath.sol";
import "../Dependencies/OwnableTransfer.sol";
import "../Dependencies/CheckContract.sol";
import "../Dependencies/SafeMath.sol";

contract SableRewarder is ISableRewarder, OwnableTransfer, CheckContract, BaseMath {
    using SafeMath for uint;

    // --- Data ---

    string public constant NAME = "SableRewarder";

    ISABLEToken public sableToken;

    ISableStakingV2 public sableStaking;
    address public sableStakingAddress;

    uint public totalSABLEIssued;
    uint public immutable deploymentTime;

    uint public lastIssuanceTime;
    uint public latestRewardPerSec;

    bool private initialized;

    // --- Events ---

    event SABLETokenAddressSet(address _sableTokenAddress);
    event SableStakingAddressSet(address _sableStakingddress);
    event TotalSABLEIssuedUpdated(uint _totalSABLEIssued);

    // --- Functions ---

    constructor() public {
        deploymentTime = block.timestamp;
        lastIssuanceTime = block.timestamp;
    }

    function setParams(
        address _sableTokenAddress,
        address _sableStakingAddress,
        uint256 _latestRewardPerSec
    ) external override onlyOwner {
        require(!initialized, "Contract instance already set param");

        checkContract(_sableTokenAddress);
        checkContract(_sableStakingAddress);

        latestRewardPerSec = _latestRewardPerSec;

        sableToken = ISABLEToken(_sableTokenAddress);
        sableStaking = ISableStakingV2(_sableStakingAddress);
        sableStakingAddress = _sableStakingAddress;

        emit SABLETokenAddressSet(_sableTokenAddress);
        emit SableStakingAddressSet(_sableStakingAddress);
        emit RewardPerSecUpdated(_latestRewardPerSec);

        initialized = true;
    }

    function issueSABLE() external override {
        _requireCallerIsSableStaking();
        _issueSABLE();
    }

    function _issueSABLE() internal {
        uint timeSinceLastIssue = block.timestamp.sub(lastIssuanceTime);
        uint issuance = latestRewardPerSec.mul(timeSinceLastIssue);
        
        totalSABLEIssued = totalSABLEIssued.add(issuance);
        lastIssuanceTime = block.timestamp;

        sendSABLE(issuance);
        sableStaking.increaseF_SABLE(issuance);

        emit TotalSABLEIssuedUpdated(totalSABLEIssued);
    }

    function updateRewardPerSec(uint newRewardPerSec) external override onlyOwner {
        _issueSABLE();
        require(lastIssuanceTime == block.timestamp);
        latestRewardPerSec = newRewardPerSec;
        emit RewardPerSecUpdated(newRewardPerSec);
    }

    function sendSABLE(uint _SABLEamount) internal {
        sableToken.transfer(sableStakingAddress, _SABLEamount);
    }

    function balanceSABLE() external override returns (uint) {
        return sableToken.balanceOf(address(this));
    }

    function transferOwnership(address newOwner) external override onlyOwner {
        _transferOwnership(newOwner);
    }

    // --- 'require' functions ---

    function _requireCallerIsSableStaking() internal view {
        require(msg.sender == address(sableStaking), "SableRewarder: caller is not Staking");
    }
}
