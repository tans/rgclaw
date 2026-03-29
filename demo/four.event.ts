import { contractABI, rushABI } from "./abi";
import {
  createPublicClient,
  decodeEventLog,
  http,
  webSocket,
  fallback,
} from "viem";
import { bsc } from "viem/chains";
import { eventHandler, eventHandlerRush } from "./eventHandler";
// const web3 = new Web3('wws://bsc-mainnet.infura.io/v3/a92fe6aa09ce495a8e1590374525d6cc');

const contractAddress = "0x5c952063c7fc8610ffdb798152d69f0b9550762b";
const rustContractAddress = "0x87fd30d61a8dce9150e173be9bf53e7f1c55dff8";

const client = createPublicClient({
  chain: bsc,

  transport: webSocket(
    "wss://rpc.ankr.com/bsc/ws/3166d8e31b55e0fe57a156e6e33531f6db77384dbfca10fc0fac9754a227728e",
  ),
  // transport: fallback([webSocket(`wss://bsc-mainnet.infura.io/ws/v3/76865b6d9d9547668340e9fdbc444a85`), webSocket(`wss://bsc-mainnet.infura.io/ws/v3/a92fe6aa09ce495a8e1590374525d6cc`)]),
});

let eventFilter = {
  address: contractAddress,
  abi: contractABI,
  eventName: "LiquidityAdded",
  onLogs: (logs: any) => {
    for (let log of logs) {
      eventHandler(log).then().catch(console.error);
    }
  },
};

let eventFilter2 = {
  address: contractAddress,
  abi: contractABI,
  eventName: "TokenPurchase",
  onLogs: (logs: any) => {
    for (let log of logs) {
      eventHandler(log).then().catch(console.error);
    }
  },
};

let eventFilter3 = {
  address: contractAddress,
  abi: contractABI,
  eventName: "TokenCreate",
  onLogs: (logs: any) => {
    for (let log of logs) {
      eventHandler(log).then().catch(console.error);
    }
  },
};

let eventFilterRush = {
  address: rustContractAddress,
  abi: rushABI,
  onLogs: (logs: any) => {
    for (let log of logs) {
      eventHandlerRush(log).then().catch(console.error);
    }
  },
};

client.watchContractEvent(eventFilter);
// client.watchContractEvent(eventFilter2);
client.watchContractEvent(eventFilter3);
// client.watchContractEvent(eventFilterRush);
console.log("start watch", new Date(), process.env.INFURA_API_KEY);
