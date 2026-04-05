/**
 * Test script: send a WeChat message to 268bcf362c88@im.bot (dev)
 *
 * Usage:
 *   # Option 1: bun run scripts/test-send-message.ts <hub_api_key> <hub_channel_id>
 *   bun run scripts/test-send-message.ts sk_xxx channel_xxx
 *
 *   # Option 2: Set env vars and run without args
 *   HUB_API_KEY=sk_xxx HUB_CHANNEL_ID=channel_xxx bun run scripts/test-send-message.ts
 *
 * Prerequisites (one of the above):
 *   - Bot 268bcf362c88 is already logged in and bound
 *   - Active channel binding exists in channel_bindings table
 *   - HUB_API_KEY and HUB_CHANNEL_ID env vars are set
 */

import { hubSendChannelMessage } from "../src/openilink/client";
import { config } from "../src/shared/config";

const TARGET_USER_ID = "268bcf362c88@im.bot";

function getArgs(): { apiKey: string; channelId: string } {
  // Priority 1: command-line args
  if (process.argv.length >= 4) {
    return { apiKey: process.argv[2], channelId: process.argv[3] };
  }

  // Priority 2: env vars
  const apiKey = process.env.HUB_API_KEY;
  const channelId = process.env.HUB_CHANNEL_ID;
  if (apiKey && channelId) {
    return { apiKey, channelId };
  }

  console.error("[test] Usage:");
  console.error("  bun run scripts/test-send-message.ts <hub_api_key> <hub_channel_id>");
  console.error("  or set HUB_API_KEY and HUB_CHANNEL_ID env vars");
  process.exit(1);
  throw new Error("unreachable");
}

async function main() {
  const { apiKey, channelId } = getArgs();
  const testMessage = "Hello from test script! 时间: " + new Date().toISOString();

  console.log("[test] Target user:", TARGET_USER_ID);
  console.log("[test] Hub URL:", config.openilinkHubUrl);
  console.log("[test] Channel ID:", channelId);
  console.log("[test] Message:", testMessage);

  try {
    const result = await hubSendChannelMessage(apiKey, channelId, {
      to_user_id: TARGET_USER_ID,
      content: testMessage,
      context_token: undefined,
    });

    console.log("\n[test] Result:", JSON.stringify(result, null, 2));
    if (result.success) {
      console.log("[test] SUCCESS: Message sent to", TARGET_USER_ID);
    } else {
      console.error("[test] FAILED: server returned success=false");
      process.exit(1);
    }
  } catch (err) {
    console.error("[test] FAILED:", err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

main();
