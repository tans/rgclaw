import type { CollectorClient } from "./client";
import {
  getLogsInBatches,
  parseAddressWord,
  resolveEventTime,
  resolveTokenSymbol,
  toLogIndex,
} from "./rpc";

export const FOUR_CONTRACT_ADDRESS = "0x5c952063c7fc8610ffdb798152d69f0b9550762b";
export const FOUR_TOKEN_CREATE_TOPIC =
  "0xf2f3fa75816e73e0dabc4b7113147b6221e8f653c60044c9e07cfb47eb04dbeb"; // LiquidityAdded

export type FourLaunchLog = {
  transactionHash: string;
  logIndex: number;
  eventTime?: string;
  args: {
    memeToken?: string;
    token?: string;
    symbol?: string;
  };
};

export function normalizeFourEvent(log: FourLaunchLog) {
  const tokenAddress = log.args.memeToken ?? log.args.token ?? "";
  const symbol = log.args.symbol ?? null;

  return {
    source: "four",
    sourceEventId: `${log.transactionHash}:${log.logIndex}`,
    tokenAddress,
    symbol,
    title: `${symbol ?? tokenAddress} 发射`,
    eventTime: log.eventTime ?? new Date().toISOString(),
    chain: "bsc",
    rawPayload: JSON.stringify(log),
    dedupeKey: `four:${tokenAddress}`,
  };
}

export async function collectFourLaunchEvents(
  client: Pick<CollectorClient, "getLogs" | "getBlock" | "readContract">,
  fromBlock: bigint,
  toBlock: bigint,
  batchSize = 50n,
) {
  const logs = await getLogsInBatches(client, {
    address: FOUR_CONTRACT_ADDRESS,
    topics: [FOUR_TOKEN_CREATE_TOPIC],
    fromBlock,
    toBlock,
    batchSize,
  });

  return Promise.all(
    logs.map(async (log) => {
      const tokenAddress = log.args?.memeToken ?? log.args?.token ?? parseAddressWord(log.data, 0);
      const symbol = await resolveTokenSymbol(client, tokenAddress);
      const eventTime = await resolveEventTime(client, log);

      return normalizeFourEvent({
        transactionHash: log.transactionHash,
        logIndex: toLogIndex(log.logIndex),
        eventTime,
        args: {
          memeToken: tokenAddress,
          symbol: symbol ?? undefined,
        },
      });
    }),
  );
}
