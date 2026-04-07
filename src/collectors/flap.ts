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
  "0x504e7f360b2e5fe33cbaaae4c593bc55305328341bf79009e43e0e3b7f699603"; // LaunchedToDEX

export type FlapLaunchLog = {
  transactionHash: string;
  logIndex: number;
  eventTime?: string;
  args: {
    token?: string;
    symbol?: string;
  };
  topics?: string[];
};

export function normalizeFlapEvent(log: FlapLaunchLog) {
  // BSC RPC may not decode ABI if it doesn't have the contract ABI cached.
  // log.args.token is only present when RPC successfully decodes the event.
  // For FLAP LaunchedToDEX, token is NOT indexed, so it appears in data word 1.
  // If args.token is missing, we still need to parse from data in the calling function.
  const tokenAddress = log.args?.token ?? "";
  const symbol = log.args?.symbol ?? null;

  return {
    source: "flap",
    sourceEventId: `${log.transactionHash}:${log.logIndex}`,
    tokenAddress,
    symbol,
    title: `${symbol ?? tokenAddress} 发射`,
    eventTime: log.eventTime ?? new Date().toISOString(),
    chain: "bsc",
    rawPayload: JSON.stringify(log),
    dedupeKey: `flap:${tokenAddress}`,
  };
}

/**
 * Extract an address from topics array at the given index.
 * Indexed address parameters are stored as topics[index] with 12 bytes padding.
 * Returns undefined if the topic doesn't exist or can't be parsed.
 */
function parseAddressWordFromTopics(topics: string[] | undefined, index: number): string | undefined {
  if (!topics || index >= topics.length) {
    return undefined;
  }
  const topic = topics[index];
  if (!topic || topic === "0x" || topic.length < 26) {
    return undefined;
  }
  // Address is stored as 32 bytes with 12 zero bytes prefix
  // e.g., "0x0000000000000000000000008731fd57abcb8ba055c073e4c1df1e5b62a987d4"
  const addr = "0x" + topic.slice(26);
  return addr.toLowerCase();
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
      // BSC RPC may not decode ABI if it doesn't have the contract ABI cached.
      // Token is an indexed parameter, so it appears in topics[1], not in data.
      const tokenAddress =
        log.args?.token ??
        parseAddressWordFromTopics(log.topics ?? [], 1) ??
        parseAddressWord(log.data, 1);
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
