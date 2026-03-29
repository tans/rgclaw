export const config = {
  databasePath: process.env.DATABASE_PATH ?? "./data/app.sqlite",
  bscRpcUrl: process.env.BSC_RPC_URL ?? "https://public-bsc.nownodes.io/",
  collectorLookbackBlocks: Number(process.env.COLLECTOR_LOOKBACK_BLOCKS ?? 200),
  collectorBatchBlocks: Number(process.env.COLLECTOR_BATCH_BLOCKS ?? 50),
  bnbCollectionWallet: "0xaCEa067c6751083e4e652543A436638c1e777777",
  priceUnitWei: "5000000000000000",
  trialDays: 3,
  reminderLeadDays: 1,
};
