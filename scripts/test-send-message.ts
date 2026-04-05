/**
 * Test script: send a WeChat message to 268bcf362c88@im.bot (dev)
 *
 * Usage:
 *   bun run scripts/test-send-message.ts
 *
 * Credentials and context token are read from the server's /root/.wechatbot/ storage.
 * Must be run on the server (or with SSH access to /root/.wechatbot/).
 */

import { WeChatBot } from "@wechatbot/wechatbot";
import { readFileSync } from "fs";

const TARGET_USER = "268bcf362c88@im.bot";
const MESSAGE = "测试 from regou.app " + new Date().toISOString();

async function main() {
  // Read credentials from the bot's storage
  const credsPath = "/root/.wechatbot/credentials.json";
  const ctxPath = "/root/.wechatbot/context_tokens.json";

  const creds: {
    token: string;
    baseUrl: string;
    accountId: string;
    userId: string;
  } = JSON.parse(readFileSync(credsPath, "utf-8"));

  const contextTokens: Record<string, string> = JSON.parse(readFileSync(ctxPath, "utf-8"));
  const contextToken = contextTokens[creds.userId];

  if (!contextToken) {
    console.error("[test] No context token found for user:", creds.userId);
    process.exit(1);
  }

  console.log("[test] Target:", TARGET_USER);
  console.log("[test] Bot userId:", creds.userId);
  console.log("[test] Message:", MESSAGE);

  const bot = new WeChatBot({
    baseUrl: creds.baseUrl,
    token: creds.token,
    botId: creds.accountId,
    accountId: creds.accountId,
    storage: "file",
    storageDir: "/root/.wechatbot",
  } as any);

  try {
    await (bot as any).login();
    console.log("[test] Logged in");

    // Use sendText which properly resolves context token
    await (bot as any).sender.sendText(
      creds.baseUrl,
      creds.token,
      creds.userId, // send to self
      MESSAGE,
      contextToken
    );

    console.log("\n[test] SUCCESS:", MESSAGE);
  } catch (err) {
    console.error("[test] FAILED:", err instanceof Error ? err.message : String(err));
    process.exit(1);
  } finally {
    try { (bot as any).stop?.(); } catch {}
  }
}

main();
