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
  "0x7db52723a3b2cdd6164364b3b766e65e540d7be48ffa89582956d8eaebe62942"; // TokenCreated (4-byte scanner top event)

export type FourLaunchLog = {
  transactionHash: string;
  logIndex: number;
  eventTime?: string;
  args: {
    memeToken?: string;
    token?: string;
    symbol?: string;
  };
  topics?: string[];
};

export function normalizeFourEvent(log: FourLaunchLog) {
  // BSC RPC may not decode ABI if it doesn't have the contract ABI cached.
  // log.args.memeToken/log.args.token is only present when RPC successfully decodes the event.
  // For indexed address parameters, the value is typically in topics[1].
  const tokenAddress =
    log.args.memeToken ??
    log.args.token ??
    parseAddressWordFromTopics(log.topics ?? [], 1) ??
    "";
  const symbol = log.args.symbol ?? null;

  return {
    source: "four",
    sourceEventId: `${log.transactionHash}:${log.logIndex}`,
    tokenAddress,
    symbol,
    title: `${symbol ?? tokenAddress} 首发 DEX`,
    eventTime: log.eventTime ?? new Date().toISOString(),
    chain: "bsc",
    rawPayload: JSON.stringify(log),
    dedupeKey: `four:${tokenAddress}`,
  };
}

/**
 * Extract an address from topics array at the given index.
 * Indexed address parameters are stored as topics[index] with 12 bytes padding.
 */
function parseAddressWordFromTopics(topics: string[], index: number): string | undefined {
  if (index < topics.length) {
    const topic = topics[index];
    // Address is stored as 32 bytes with 12 zero bytes prefix
    // e.g., "0x0000000000000000000000008731fd57abcb8ba055c073e4c1df1e5b62a987d4"
    const addr = "0x" + topic.slice(26);
    return addr.toLowerCase();
  }
  return undefined;
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
      // BSC RPC may not decode ABI if it doesn't have the contract ABI cached.
      // Token is likely an indexed parameter, so check topics[1] first.
      const tokenAddress =
        log.args?.memeToken ??
        log.args?.token ??
        parseAddressWordFromTopics(log.topics ?? [], 1) ??
        parseAddressWord(log.data, 1);
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
