export const config = {
  get databasePath() {
    return process.env.DATABASE_PATH ?? "./data/app.sqlite";
  },
  get bscRpcUrl() {
    return process.env.BSC_RPC_URL ?? "https://public-bsc.nownodes.io/";
  },
  get collectorLookbackBlocks() {
    return Number(process.env.COLLECTOR_LOOKBACK_BLOCKS ?? 200);
  },
  get collectorBatchBlocks() {
    return Number(process.env.COLLECTOR_BATCH_BLOCKS ?? 50);
  },
  bnbCollectionWallet: "0xaCEa067c6751083e4e652543A436638c1e777777",
  priceUnitWei: "5000000000000000",
  trialDays: 3,
  reminderLeadDays: 1,
  get openilinkHubUrl() {
    return process.env.OPENILINK_HUB_URL ?? "https://hub.openilink.com";
  },
  get openilinkAdminUrl() {
    return process.env.OPENILINK_ADMIN_URL ?? "https://admin.openilink.com";
  },
  get openilinkOAuthCallbackUrl() {
    return process.env.OPENILINK_OAUTH_CALLBACK_URL ?? "http://localhost:3000/auth/callback";
  },
  get wechatBotApiBaseUrl() {
    return process.env.WECHAT_BOT_API_BASE_URL ?? "https://example.invalid/wechat";
  },
  get wechatBotApiToken() {
    return process.env.WECHAT_BOT_API_TOKEN ?? "replace-me";
  },
  get wechatBindSecret() {
    return process.env.WECHAT_BIND_SECRET ?? "dev-wechat-bind-secret";
  },
  get wechatCallbackAllowlist() {
    return (process.env.WECHAT_CALLBACK_ALLOWLIST ?? "127.0.0.1,::1")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean);
  },
  get wechatKeepaliveEnabled() {
    return process.env.WECHAT_KEEPALIVE_ENABLED === "true";
  },
};
