import { decodeEventLog, parseAbi } from "viem";
import type { CollectorClient } from "./client";
import {
  getLogsInBatches,
  resolveEventTime,
  resolveTokenSymbol,
  toLogIndex,
} from "./rpc";

export const FLAP_PORTAL_ADDRESS = "0xe2ce6ab80874fa9fa2aae65d277dd6b8e65c9de0";

// LaunchedToDEX(address token, address pool, uint256 amount, uint256 eth)
const flapAbi = parseAbi([
  "event LaunchedToDEX(address token, address pool, uint256 amount, uint256 eth)",
]);

export async function collectFlapLaunchEvents(
  client: Pick<CollectorClient, "getLogs" | "getBlock" | "readContract">,
  fromBlock: bigint,
  toBlock: bigint,
  batchSize = 50n,
) {
  const logs = await getLogsInBatches(client, {
    address: FLAP_PORTAL_ADDRESS,
    event: flapAbi[0],
    fromBlock,
    toBlock,
    batchSize,
  });

  return Promise.all(
    logs.map(async (log) => {
      const decoded = decodeEventLog({
        abi: flapAbi,
        data: log.data,
        topics: log.topics,
      });

      const tokenAddress = decoded.args.token.toLowerCase();
      const symbol = await resolveTokenSymbol(client, tokenAddress);
      const eventTime = await resolveEventTime(client, log);

      return {
        source: "flap",
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
            token: decoded.args.token,
            pool: decoded.args.pool,
            amount: decoded.args.amount.toString(),
            eth: decoded.args.eth.toString(),
          },
        }),
        dedupeKey: `flap:${log.transactionHash}:${log.logIndex}`,
      };
    }),
  );
}
