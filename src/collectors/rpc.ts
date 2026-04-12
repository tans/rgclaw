type JsonRpcSuccess<Result> = {
  jsonrpc: "2.0";
  id: number;
  result: Result;
};

type JsonRpcFailure = {
  jsonrpc: "2.0";
  id: number;
  error: {
    code: number;
    message: string;
  };
};

type JsonRpcResponse<Result> = JsonRpcSuccess<Result> | JsonRpcFailure;

export type RpcLog = {
  transactionHash: string;
  logIndex: string | number | bigint;
  blockNumber: string | number | bigint;
  blockTimestamp?: string;
  data: string;
  topics: string[];
  args?: Record<string, string | undefined>;
};

type RpcClient = {
  getBlockNumber(): Promise<bigint>;
  getLogs(input: {
    address: string;
    topics?: string[];
    fromBlock: bigint;
    toBlock: bigint;
  }): Promise<RpcLog[]>;
  getBlock(input: { blockNumber: bigint }): Promise<{ timestamp: bigint }>;
  readContract(input: { address: string; functionName: "symbol" }): Promise<string>;
};

function hexToBigInt(value: string | bigint | number) {
  if (typeof value === "bigint") {
    return value;
  }

  if (typeof value === "number") {
    return BigInt(value);
  }

  return BigInt(value);
}

function decodeAbiString(hex: string) {
  if (!hex || hex === "0x") {
    return "";
  }

  const length = Number(BigInt(`0x${hex.slice(66, 130)}`));
  const data = hex.slice(130, 130 + length * 2);

  return Buffer.from(data, "hex").toString("utf8");
}

async function jsonRpc<Result>(
  urls: string[],
  method: string,
  params: unknown[],
) {
  let lastError: unknown;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    // Round-robin across available RPC endpoints
    const url = urls[attempt % urls.length];

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method,
          params,
        }),
      });

      if (response.status === 429) {
        // Respect Retry-After header if present, otherwise use exponential backoff
        const retryAfter = response.headers.get("Retry-After");
        const sleepMs = retryAfter
          ? Number(retryAfter) * 1000
          : 500 * Math.pow(2, attempt);
        throw new Error(`rpc rate limited: 429, retry-after=${retryAfter ?? "none"}`);
      }

      if (!response.ok) {
        throw new Error(`rpc request failed: ${response.status}`);
      }

      const payload = (await response.json()) as JsonRpcResponse<Result>;

      if ("error" in payload) {
        throw new Error(`rpc ${method} failed: ${payload.error.code} ${payload.error.message}`);
      }

      return payload.result;
    } catch (error) {
      lastError = error;
      // Longer backoff on 429 to respect rate limits
      const sleepMs = String(error).includes("rate limited")
        ? 500 * Math.pow(2, attempt)
        : 150 * (attempt + 1);
      await Bun.sleep(sleepMs);
    }
  }

  throw lastError;
}

const DEFAULT_RPC_URLS = [
  "https://public-bsc.nownodes.io/",
  "https://bsc-rpc.publicnode.com",
];

export function createBscRpcClient(urls?: string | string[]): RpcClient {
  const rpcUrls = Array.isArray(urls)
    ? urls
    : urls
    ? [urls]
    : DEFAULT_RPC_URLS;

  return {
    async getBlockNumber() {
      const result = await jsonRpc<string>(rpcUrls, "eth_blockNumber", []);
      return BigInt(result);
    },
    async getLogs(input) {
      return jsonRpc<RpcLog[]>(rpcUrls, "eth_getLogs", [
        {
          address: input.address,
          topics: input.topics,
          fromBlock: `0x${input.fromBlock.toString(16)}`,
          toBlock: `0x${input.toBlock.toString(16)}`,
        },
      ]);
    },
    async getBlock(input) {
      const result = await jsonRpc<{ timestamp: string }>(rpcUrls, "eth_getBlockByNumber", [
        `0x${input.blockNumber.toString(16)}`,
        false,
      ]);

      return {
        timestamp: BigInt(result.timestamp),
      };
    },
    async readContract(input) {
      const result = await jsonRpc<string>(rpcUrls, "eth_call", [
        {
          to: input.address,
          data: "0x95d89b41",
        },
        "latest",
      ]);

      return decodeAbiString(result);
    },
  };
}

export function parseAddressWord(data: string, wordIndex: number) {
  const start = 2 + wordIndex * 64;
  const word = data.slice(start, start + 64);

  if (word.length !== 64) {
    return "";
  }

  return `0x${word.slice(24)}`.toLowerCase();
}

export async function resolveEventTime(
  client: Pick<RpcClient, "getBlock">,
  log: Pick<RpcLog, "blockNumber" | "blockTimestamp">,
) {
  if (typeof log.blockTimestamp === "string" && log.blockTimestamp) {
    return new Date(Number(BigInt(log.blockTimestamp)) * 1000).toISOString();
  }

  const block = await client.getBlock({
    blockNumber: hexToBigInt(log.blockNumber),
  });

  return new Date(Number(block.timestamp) * 1000).toISOString();
}

export async function resolveTokenSymbol(
  client: Pick<RpcClient, "readContract">,
  tokenAddress: string,
) {
  try {
    const symbol = await client.readContract({
      address: tokenAddress,
      functionName: "symbol",
    });

    return symbol || null;
  } catch {
    return null;
  }
}

export function toLogIndex(value: string | number | bigint) {
  return Number(hexToBigInt(value));
}

export async function getLogsInBatches(
  client: Pick<RpcClient, "getLogs">,
  input: {
    address: string;
    topics?: string[];
    event?: { type: string; inputs: readonly unknown[] };
    fromBlock: bigint;
    toBlock: bigint;
    batchSize: bigint;
  },
) {
  const logs: RpcLog[] = [];

  // If event is provided, extract topics from it
  let topics = input.topics;
  if (input.event && !topics) {
    // Import viem's encodeEventTopics to get the event signature
    const { encodeEventTopics } = await import("viem");
    const encodedTopics = encodeEventTopics({
      abi: [input.event],
    });
    topics = encodedTopics as string[];
  }

  for (let start = input.fromBlock; start <= input.toBlock; start += input.batchSize) {
    const end =
      start + input.batchSize - 1n > input.toBlock ? input.toBlock : start + input.batchSize - 1n;
    const batch = await client.getLogs({
      address: input.address,
      topics,
      fromBlock: start,
      toBlock: end,
    });

    logs.push(...batch);
  }

  return logs;
}
