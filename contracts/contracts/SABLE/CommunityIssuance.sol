// SPDX-License-Identifier: MIT

pragma solidity 0.6.11;

import "../Interfaces/ISABLEToken.sol";
import "../Interfaces/ICommunityIssuance.sol";
import "../Interfaces/IStabilityPool.sol";
import "../Dependencies/BaseMath.sol";
import "../Dependencies/LiquityMath.sol";
import "../Dependencies/Ownable.sol";
import "../Dependencies/CheckContract.sol";
import "../Dependencies/SafeMath.sol";

contract CommunityIssuance is ICommunityIssuance, Ownable, CheckContract, BaseMath {
    using SafeMath for uint;

    // --- Data ---

    string public constant NAME = "CommunityIssuance";

    uint public constant SECONDS_IN_ONE_MINUTE = 60;

    ISABLEToken public sableToken;

    // address public stabilityPoolAddress;
    IStabilityPool public stabilityPool;

    uint public totalSABLEIssued;
    uint public immutable deploymentTime;

    uint public lastIssuanceTime;
    uint public latestRewardPerSec;

    bool private initialized;

    // --- Events ---

    event SABLETokenAddressSet(address _sableTokenAddress);
    event StabilityPoolAddressSet(address _stabilityPoolAddress);
    event TotalSABLEIssuedUpdated(uint _totalSABLEIssued);

    // --- Functions ---

    constructor() public {
        deploymentTime = block.timestamp;
        lastIssuanceTime = block.timestamp;
    }

    function setParams(
        address _sableTokenAddress,
        address _stabilityPoolAddress,
        uint256 _latestRewardPerSec
    ) external override onlyOwner {
        require(!initialized, "Contract instance already set param");

        checkContract(_sableTokenAddress);
        checkContract(_stabilityPoolAddress);

        latestRewardPerSec = _latestRewardPerSec;

        sableToken = ISABLEToken(_sableTokenAddress);
        stabilityPool = IStabilityPool(_stabilityPoolAddress);

        emit SABLETokenAddressSet(_sableTokenAddress);
        emit StabilityPoolAddressSet(_stabilityPoolAddress);
        emit RewardPerSecUpdated(_latestRewardPerSec);

        initialized = true;
    }

    function issueSABLE() external override returns (uint) {
        _requireCallerIsStabilityPool();

        uint latestTotalSABLEIssued = totalSABLEIssued +
            latestRewardPerSec *
            (block.timestamp - lastIssuanceTime);
        uint issuance = latestTotalSABLEIssued.sub(totalSABLEIssued);

        totalSABLEIssued = latestTotalSABLEIssued;
        lastIssuanceTime = block.timestamp;
        emit TotalSABLEIssuedUpdated(latestTotalSABLEIssued);
        return issuance;
    }

    function updateRewardPerSec(uint newRewardPerSec) external override onlyOwner {
        stabilityPool.ownerTriggerIssuance();
        require(lastIssuanceTime == block.timestamp);
        latestRewardPerSec = newRewardPerSec;
        emit RewardPerSecUpdated(newRewardPerSec);
    }

    function sendSABLE(address _account, uint _SABLEamount) external override {
        _requireCallerIsStabilityPool();

        sableToken.transfer(_account, _SABLEamount);
    }

    function balanceSABLE() external override returns (uint) {
        return sableToken.balanceOf(address(this));
    }

    // --- 'require' functions ---

    function _requireCallerIsStabilityPool() internal view {
        require(msg.sender == address(stabilityPool), "CommunityIssuance: caller is not SP");
    }
}
