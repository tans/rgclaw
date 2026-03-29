export type CollectorClient = {
  getBlockNumber(): Promise<bigint>;
  getLogs(input: {
    address: string;
    topics?: string[];
    fromBlock: bigint;
    toBlock: bigint;
  }): Promise<
    Array<{
      transactionHash: string;
      logIndex: string | number | bigint;
      blockNumber: string | number | bigint;
      blockTimestamp?: string;
      data: string;
      topics: string[];
      args?: Record<string, string | undefined>;
    }>
  >;
  getBlock(input: { blockNumber: bigint }): Promise<{ timestamp: bigint }>;
  readContract(input: { address: string; functionName: "symbol" }): Promise<string>;
};
