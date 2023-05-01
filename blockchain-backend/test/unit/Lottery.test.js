const { deployments, ethers, getNamedAccounts, network } = require("hardhat");
const { assert, expect } = require("chai");
const {
  developmentChains,
  networkConfig,
} = require("../../helper-hardhat-config");

!developmentChains.includes(network.name)
  ? describe.skip
  : describe("Lottery", () => {
      let lottery, deployer, vrfCoordinatorV2Mock, lotteryEntryFee, interval;
      const chainId = network.config.chainId;

      beforeEach(async () => {
        accounts = await ethers.getSigners(); // could also do with getNamedAccounts
        //   deployer = accounts[0]
        player = accounts[1];
        await deployments.fixture(["all"]);
        lotteryContract = await ethers.getContract("Lottery");
        lottery = lotteryContract.connect(player);
        vrfCoordinatorV2Mock = await ethers.getContract("VRFCoordinatorV2Mock");
        lotteryEntryFee = await lottery.getEntranceFee();
        interval = await lottery.getInterval();
      });

      describe("constructor", () => {
        it("Initialises Lottery correctly", async () => {
          const lotteryState = await lottery.getLotteryState();
          const interval = await lottery.getInterval();
          assert.equal(lotteryState.toString(), "0");
          assert.equal(
            interval,
            networkConfig[chainId]["keepersUpdateInterval"]
          );
        });
      });

      describe("enterLottery", () => {
        it("Test min lottery entry fee", async () => {
          await expect(lottery.enterLottery()).to.be.revertedWith(
            "sendMoreETH"
          );
        });

        it("record players when they enter", async () => {
          await lottery.enterLottery({ value: lotteryEntryFee });
          const lotteryPlayer = await lottery.getPlayer(0);
          assert.equal(lotteryPlayer, player.address);
        });

        it("emits event on enter", async () => {
          await expect(
            lottery.enterLottery({ value: lotteryEntryFee })
          ).to.emit(lottery, "lotteryEnter");
        });

        it("doesn't allow entrance when lottery is calculating", async () => {
          await lottery.enterLottery({ value: lotteryEntryFee });
          // for a documentation of the methods below, go here: https://hardhat.org/hardhat-network/reference
          await network.provider.send("evm_increaseTime", [
            interval.toNumber() + 1,
          ]);
          await network.provider.request({ method: "evm_mine", params: [] });
          // we pretend to be a keeper for a second
          await lottery.performUpkeep([]); // changes the state to calculating for our comparison below
          await expect(
            lottery.enterLottery({ value: lotteryEntryFee })
          ).to.be.revertedWith(
            // is reverted as raffle is calculating
            "lotteryNotOpen"
          );
        });
      });

      describe("checkUpkeep", () => {
        it("Returns false if no money is sent", async () => {
          await network.provider.send("evm_increaseTime", [
            interval.toNumber() + 1,
          ]);
          await network.provider.request({ method: "evm_mine", params: [] });
          const { upkeepNeeded } = await lottery.callStatic.checkUpkeep([]);
          assert(!upkeepNeeded);
        });

        it("returns false if lottery not open", async () => {
          await lottery.enterLottery({ value: lotteryEntryFee });
          await network.provider.send("evm_increaseTime", [
            interval.toNumber() + 1,
          ]);
          await network.provider.request({ method: "evm_mine", params: [] });
          await lottery.performUpkeep([]);
          const lotteryState = await lottery.getLotteryState(); // stores the new state
          const { upkeepNeeded } = await lottery.callStatic.checkUpkeep("0x"); // upkeepNeeded = (timePassed && isOpen && hasBalance && hasPlayers)
          assert.equal(lotteryState.toString() == "1", upkeepNeeded == false);
        });
      });

      describe("performUpkeep", () => {
        it("can only run if checkUpkeep is true", async () => {
          await lottery.enterLottery({ value: lotteryEntryFee });
          await network.provider.send("evm_increaseTime", [
            interval.toNumber() + 1,
          ]);
          await network.provider.request({ method: "evm_mine", params: [] });
          const tx = await lottery.performUpkeep("0x");
          assert(tx);
        });

        it("updates the lottery state and emits a requestId", async () => {
          // Too many asserts in this test!
          await lottery.enterLottery({ value: lotteryEntryFee });
          await network.provider.send("evm_increaseTime", [
            interval.toNumber() + 1,
          ]);
          await network.provider.request({ method: "evm_mine", params: [] });
          const txResponse = await lottery.performUpkeep("0x"); // emits requestId
          const txReceipt = await txResponse.wait(1); // waits 1 block
          const lotteryState = await lottery.getLotteryState(); // updates state
          const requestId = txReceipt.events[1].args.requestId;
          assert(requestId.toNumber() > 0);
          assert(lotteryState == 1); // 0 = open, 1 = calculating
        });
      });

      describe("fulfill random words", () => {
        beforeEach(async () => {
          await lottery.enterLottery({ value: lotteryEntryFee });
          await network.provider.send("evm_increaseTime", [
            interval.toNumber() + 1,
          ]);
          await network.provider.request({ method: "evm_mine", params: [] });
        });

        it("can only be called after perform upKeep", async () => {
          await expect(
            vrfCoordinatorV2Mock.fulfillRandomWords(0, lottery.address) // reverts if not fulfilled
          ).to.be.revertedWith("nonexistent request");
        });

        // it("picks a winner, resets, and sends money", async () => {
        //   const additionalEntrances = 3; // to test
        //   const startingIndex = 2;
        //   for (
        //     let i = startingIndex;
        //     i < startingIndex + additionalEntrances;
        //     i++
        //   ) {
        //     // i = 2; i < 5; i=i+1
        //     lottery = lotteryContract.connect(accounts[i]); // Returns a new instance of the lottery contract connected to player
        //     await lottery.enterLottery({ value: lotteryEntryFee });
        //   }
        //   const startingTimeStamp = await lottery.getLastTimeStamp(); // stores starting timestamp (before we fire our event)

        //   await new Promise(async (resolve, reject) => {
        //     lottery.once("winnerPicked", async () => {
        //       // event listener for WinnerPicked
        //       console.log("WinnerPicked event fired!");
        //       // assert throws an error if it fails, so we need to wrap
        //       // it in a try/catch so that the promise returns event
        //       // if it fails.
        //       try {
        //         // Now lets get the ending values...
        //         const recentWinner = await lottery.getRecentWinner();
        //         const lotteryState = await lottery.getLotteryState();
        //         const winnerBalance = await accounts[2].getBalance();
        //         const endingTimeStamp = await lottery.getLastTimeStamp();
        //         await expect(lottery.getPlayer(0)).to.be.reverted;
        //         // Comparisons to check if our ending values are correct:
        //         assert.equal(recentWinner.toString(), accounts[2].address);
        //         assert.equal(lotteryState, 0);
        //         // assert.equal(
        //         //   winnerBalance.toString(),
        //         //   startingBalance // startingBalance + ( (lotteryEntryFee * additionalEntrances) + lotteryEntryFee )
        //         //     .add(
        //         //       lotteryEntryFee
        //         //         .mul(additionalEntrances)
        //         //         .add(lotteryEntryFee)
        //         //     )
        //         //     .toString()
        //         // );
        //         assert(endingTimeStamp > startingTimeStamp);
        //         resolve(); // if try passes, resolves the promise
        //       } catch (e) {
        //         reject(e); // if try fails, rejects the promise
        //       }
        //     });

        //     const tx = await lottery.performUpkeep("0x");
        //     const txReceipt = await tx.wait(1);
        //     const startingBalance = await accounts[1].getBalance();
        //     console.log("-------------------");

        //     await vrfCoordinatorV2Mock.fulfillRandomWords(
        //       txReceipt.events[1].args.requestId,
        //       lottery.address
        //     );

        //     console.log("-------------------");
        //   });
        // });
      });
    });
