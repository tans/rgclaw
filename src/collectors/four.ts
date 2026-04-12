import { decodeEventLog, parseAbi } from "viem";
import type { CollectorClient } from "./client";
import {
  getLogsInBatches,
  resolveEventTime,
  resolveTokenSymbol,
  toLogIndex,
} from "./rpc";

export const FOUR_CONTRACT_ADDRESS = "0x5c952063c7fc8610ffdb798152d69f0b9550762b";

// LiquidityAdded(address base, uint256 offers, address quote, uint256 funds)
const fourAbi = parseAbi([
  "event LiquidityAdded(address base, uint256 offers, address quote, uint256 funds)",
]);

export async function collectFourLaunchEvents(
  client: Pick<CollectorClient, "getLogs" | "getBlock" | "readContract">,
  fromBlock: bigint,
  toBlock: bigint,
  batchSize = 50n,
) {
  const logs = await getLogsInBatches(client, {
    address: FOUR_CONTRACT_ADDRESS,
    event: fourAbi[0],
    fromBlock,
    toBlock,
    batchSize,
  });

  return Promise.all(
    logs.map(async (log) => {
      const decoded = decodeEventLog({
        abi: fourAbi,
        data: log.data,
        topics: log.topics,
      });

      const tokenAddress = decoded.args.base.toLowerCase();
      const symbol = await resolveTokenSymbol(client, tokenAddress);
      const eventTime = await resolveEventTime(client, log);

      return {
        source: "four",
        sourceEventId: `${log.transactionHash}:${log.logIndex}`,
        tokenAddress,
        symbol,
        title: symbol ?? null,
        eventTime: eventTime ?? new Date().toISOString(),
        chain: "bsc",
        rawPayload: JSON.stringify({
          transactionHash: log.transactionHash,
          logIndex: toLogIndex(log.logIndex),
          args: {
            base: decoded.args.base,
            offers: decoded.args.offers.toString(),
            quote: decoded.args.quote,
            funds: decoded.args.funds.toString(),
          },
        }),
        dedupeKey: `four:${log.transactionHash}:${log.logIndex}`,
      };
    }),
  );
}
