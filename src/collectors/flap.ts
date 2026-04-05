import type { CollectorClient } from "./client";
import {
  getLogsInBatches,
  parseAddressWord,
  resolveEventTime,
  resolveTokenSymbol,
  toLogIndex,
} from "./rpc";

export const FLAP_PORTAL_ADDRESS = "0xe2ce6ab80874fa9fa2aae65d277dd6b8e65c9de0";
export const FLAP_LAUNCHED_TOPIC =
  "0x115c78ad17c4763fb97bca94f3e59dc8cb2e59c9d3862f24a694ec401200f562";

export type FlapLaunchLog = {
  transactionHash: string;
  logIndex: number;
  eventTime?: string;
  args: {
    token: string;
    symbol?: string;
  };
};

export function normalizeFlapEvent(log: FlapLaunchLog) {
  const symbol = log.args.symbol ?? null;

  return {
    source: "flap",
    sourceEventId: `${log.transactionHash}:${log.logIndex}`,
    tokenAddress: log.args.token,
    symbol,
    title: `${symbol ?? log.args.token} 发射`,
    eventTime: log.eventTime ?? new Date().toISOString(),
    chain: "bsc",
    rawPayload: JSON.stringify(log),
    dedupeKey: `flap:${log.args.token}`,
  };
}

export async function collectFlapLaunchEvents(
  client: Pick<CollectorClient, "getLogs" | "getBlock" | "readContract">,
  fromBlock: bigint,
  toBlock: bigint,
  batchSize = 50n,
) {
  const logs = await getLogsInBatches(client, {
    address: FLAP_PORTAL_ADDRESS,
    topics: [FLAP_LAUNCHED_TOPIC],
    fromBlock,
    toBlock,
    batchSize,
  });

  return Promise.all(
    logs.map(async (log) => {
      const tokenAddress = log.args?.token ?? parseAddressWord(log.data, 0);
      const symbol = await resolveTokenSymbol(client, tokenAddress);
      const eventTime = await resolveEventTime(client, log);

      return normalizeFlapEvent({
        transactionHash: log.transactionHash,
        logIndex: toLogIndex(log.logIndex),
        eventTime,
        args: {
          token: tokenAddress,
          symbol: symbol ?? undefined,
        },
      });
    }),
  );
}
