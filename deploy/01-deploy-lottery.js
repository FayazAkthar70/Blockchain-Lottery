const { network } = require("hardhat");
const { verify } = require("../utils/verify");
const {
  networkConfig,
  developmentChains,
} = require("../helper-hardhat-config");

module.exports = async ({ getNamedAccounts, deployments }) => {
  const { deploy, log } = deployments;
  const { deployer } = await getNamedAccounts();
  const chainId = network.config.chainId;
  const FUND_AMOUNT = ethers.utils.parseEther("1");
  let vrfCoordinatorV2Address, subscriptionId, vrfCoordinatorV2Mock;
  if (chainId == 31337) {
    vrfCoordinatorV2Mock = await ethers.getContract("VRFCoordinatorV2Mock");
    vrfCoordinatorV2Address = vrfCoordinatorV2Mock.address;
    const transactionResponse = await vrfCoordinatorV2Mock.createSubscription();
    const transactionReceipt = await transactionResponse.wait();
    subscriptionId = transactionReceipt.events[0].args.subId;
    // Fund the subscription
    // Our mock makes it so we don't actually have to worry about sending fund
    await vrfCoordinatorV2Mock.fundSubscription(subscriptionId, FUND_AMOUNT);
  } else {
    vrfCoordinatorV2Address = networkConfig[chainId]["vrfCoordinatorV2"];
    subscriptionId = networkConfig[chainId]["subscriptionId"];
  }
  const args = [
    vrfCoordinatorV2Address,
    subscriptionId,
    networkConfig[chainId]["gasLane"],
    networkConfig[chainId]["keepersUpdateInterval"],
    networkConfig[chainId]["raffleEntranceFee"],
    networkConfig[chainId]["callbackGasLimit"],
  ];
  const Lottery = await deploy("Lottery", {
    from: deployer,
    log: true,
    args: args,
    waitConfirmations: network.config.blockConfirmations || 1,
  });
  if (developmentChains.includes(network.name)) {
    const vrfCoordinatorV2Mock = await ethers.getContract(
      "VRFCoordinatorV2Mock"
    );
    console.log(`subscription id is ${subscriptionId}`);
    await vrfCoordinatorV2Mock.addConsumer(subscriptionId, Lottery.address);
  }
  if (
    !developmentChains.includes(network.name) &&
    process.env.ETHERSCAN_API_KEY
  ) {
    log("Verifying...");
    await verify(Lottery.address, args);
  }

  log("---------------------------------------------");
};
module.exports.tags = ["all", "lottery"];
