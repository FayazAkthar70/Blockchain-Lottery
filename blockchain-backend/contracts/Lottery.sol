// SPDX-License-Identifier: MIT
pragma solidity ^0.8.7;

import "@chainlink/contracts/src/v0.8/VRFConsumerBaseV2.sol";
import "@chainlink/contracts/src/v0.8/interfaces/VRFCoordinatorV2Interface.sol";
import "@chainlink/contracts/src/v0.8/interfaces/KeeperCompatibleInterface.sol";

error sendMoreETH();
error lotteryTransferFailed();
error lotteryNotOpen();
error Raffle__UpkeepNotNeeded(
    uint256 currentBalance,
    uint256 numPlayers,
    uint256 raffleState
);

contract Lottery is VRFConsumerBaseV2, KeeperCompatibleInterface {
    enum LotteryState {
        OPEN,
        CALCULATING
    }
    //chainlink VRF Variables
    VRFCoordinatorV2Interface private immutable i_vrfcoordinator;
    bytes32 private immutable i_keyHash;
    uint64 private immutable i_subscriptionId;
    uint16 private constant REQUEST_CONFIRMATIONS = 3;
    uint32 private immutable i_callbackGasLimit;
    uint32 private constant NUM_WORDS = 1;

    //Lottery Variables
    uint256 private immutable i_entranceFee;
    address[] private players;
    address private recentWinner;
    LotteryState private lotteryState;
    uint256 private lastTimeStamp;
    uint256 private immutable i_interval;

    event lotteryEnter(address indexed player);
    event requestLotteryWinner(uint256 indexed requestId);
    event winnerPicked(address indexed winner);

    constructor(
        address vrfCoordinatorV2,
        uint64 subscriptionId,
        bytes32 gasLane, // keyHash
        uint256 interval,
        uint256 entranceFee,
        uint32 callbackGasLimit
    ) VRFConsumerBaseV2(vrfCoordinatorV2) {
        i_vrfcoordinator = VRFCoordinatorV2Interface(vrfCoordinatorV2);
        i_keyHash = gasLane;
        i_interval = interval;
        i_subscriptionId = subscriptionId;
        i_entranceFee = entranceFee;
        lotteryState = LotteryState.OPEN;
        lastTimeStamp = block.timestamp;
        i_callbackGasLimit = callbackGasLimit;
    }

    function enterLottery() public payable {
        if (msg.value < i_entranceFee) {
            revert sendMoreETH();
        }
        if (lotteryState != LotteryState.OPEN) {
            revert lotteryNotOpen();
        }
        players.push(payable(msg.sender));
        emit lotteryEnter(msg.sender);
    }

    function checkUpkeep(
        bytes memory /* checkData */
    )
        public
        view
        override
        returns (bool upkeepNeeded, bytes memory /* performData */)
    {
        bool isOpen = LotteryState.OPEN == lotteryState;
        bool timePassed = ((block.timestamp - lastTimeStamp) > i_interval);
        bool hasPlayers = players.length > 0;
        bool hasBalance = address(this).balance > 0;
        upkeepNeeded = (timePassed && isOpen && hasBalance && hasPlayers);
        return (upkeepNeeded, "0x0"); // can we comment this out?
    }

    function performUpkeep(bytes calldata /* performData */) external override {
        (bool upkeepNeeded, ) = checkUpkeep("");
        // require(upkeepNeeded, "Upkeep not needed");
        if (!upkeepNeeded) {
            revert Raffle__UpkeepNotNeeded(
                address(this).balance,
                players.length,
                uint256(lotteryState)
            );
        }
        lotteryState = LotteryState.CALCULATING;
        uint256 requestId = i_vrfcoordinator.requestRandomWords(
            i_keyHash,
            i_subscriptionId,
            REQUEST_CONFIRMATIONS,
            i_callbackGasLimit,
            NUM_WORDS
        );

        emit requestLotteryWinner(requestId);
    }

    function fulfillRandomWords(
        uint256, //**requestId
        uint256[] memory randomWords
    ) internal override {
        uint256 winnerIndex = randomWords[0] % players.length;
        recentWinner = players[winnerIndex];
        (bool callSuccess, ) = payable(msg.sender).call{
            value: address(this).balance
        }("");
        if (!callSuccess) {
            revert lotteryTransferFailed();
        }
        lotteryState = LotteryState.OPEN;
        players = new address payable[](0);
        lastTimeStamp = block.timestamp;
        emit winnerPicked(recentWinner);
    }

    function getPlayer(uint index) public view returns (address) {
        return players[index];
    }

    function getRecentWinner() public view returns (address) {
        return recentWinner;
    }

    function getLotteryState() public view returns (LotteryState) {
        return lotteryState;
    }

    function getLastTimeStamp() public view returns (uint256) {
        return lastTimeStamp;
    }

    function getInterval() public view returns (uint256) {
        return i_interval;
    }

    function getEntranceFee() public view returns (uint256) {
        return i_entranceFee;
    }

    function getNumberOfPlayers() public view returns (uint256) {
        return players.length;
    }
}
