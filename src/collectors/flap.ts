export type FlapLaunchLog = {
  transactionHash: string;
  logIndex: number;
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
    eventTime: new Date().toISOString(),
    chain: "bsc",
    rawPayload: JSON.stringify(log),
    dedupeKey: `flap:${log.transactionHash}:${log.logIndex}`,
  };
}
