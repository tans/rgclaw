// https://docs.flap.sh/flap/developers/deployed-contract-addresses
// https://docs.flap.sh/flap/developers/token-migration
import axios from "axios";
import { createPublicClient, webSocket } from "viem";
import { bsc } from "viem/chains";
import { getSymbol } from "./utils";

const flapPortalAddress = "0xe2cE6ab80874Fa9Fa2aAE65D277Dd6B8e65C9De0";

const flapABI = [
  {
    type: "event",
    name: "LaunchedToDEX",
    inputs: [
      { indexed: false, name: "token", type: "address" },
      { indexed: false, name: "pool", type: "address" },
      { indexed: false, name: "amount", type: "uint256" },
      { indexed: false, name: "eth", type: "uint256" },
    ],
  },
];

const client = createPublicClient({
  chain: bsc,
  transport: webSocket(
    "wss://rpc.ankr.com/bsc/ws/3166d8e31b55e0fe57a156e6e33531f6db77384dbfca10fc0fac9754a227728e",
  ),
});

const sendTelegramNotification = async (
  symbol: string,
  tokenAddress: string,
) => {
  try {
    await axios.post("http://rgbot.vip:20221/send-regou", {
      text: `<b>#Flap 上 DEX</b>
<b>${symbol}</b>
<code>${tokenAddress}</code>
<b>数据来源 rgbot.vip</b>
`,
      reply_markup: {
        inline_keyboard: [
          [
            {
              text: "交易",
              url: `https://lvswap.app/?p=regou&out=${tokenAddress}`,
            },
            { text: "讨论", url: `https://t.me/regoujuji` },
            {
              text: "X",
              url: `https://x.com/search?q=${tokenAddress}&src=typed_query`,
            },
          ],
        ],
      },
    });
  } catch (err) {
    console.error(err);
  }
};

const sendPingoNotification = async (symbol: string, tokenAddress: string) => {
  const url = `https://pingo.minapp.xin/channel/flap/push`;
  const content = `#Flap 上 DEX
${symbol}
${tokenAddress}`;
  await axios.post(url, {
    content,
  });
};

const handleLaunchedToDex = async (log: any) => {
  try {
    const tokenAddress = log.args.token;
    const symbol = await getSymbol(tokenAddress);
    console.log("list on dex");
    await Promise.all([
      sendTelegramNotification(symbol, tokenAddress),
      sendPingoNotification(symbol, tokenAddress),
    ]);
  } catch (err) {
    console.error(err);
  }
};

client.watchContractEvent({
  address: flapPortalAddress,
  abi: flapABI,
  eventName: "LaunchedToDEX",
  onLogs: (logs: any[]) => {
    for (const log of logs) {
      handleLaunchedToDex(log).catch(console.error);
    }
  },
});

console.log("start watch", new Date());
