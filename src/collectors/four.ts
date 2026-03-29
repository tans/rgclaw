export type FourLaunchLog = {
  transactionHash: string;
  logIndex: number;
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
    eventTime: new Date().toISOString(),
    chain: "bsc",
    rawPayload: JSON.stringify(log),
    dedupeKey: `four:${log.transactionHash}:${log.logIndex}`,
  };
}
