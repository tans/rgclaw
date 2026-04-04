import { Hono } from "hono";
import { getCookie } from "hono/cookie";
import {
  hubListBots,
  hubStartBotBind,
  hubConfirmBotBind,
  hubGetBotStatus,
} from "../../openilink/client";
import {
  findActiveChannelBindingByUserId,
  replaceActiveChannelBinding,
} from "../../db/repositories/channel-bindings";
import { ensureTrialEntitlement } from "../../db/repositories/entitlements";
import type { AppEnv } from "../middleware/session";

// How long a pending bind QR stays valid before it expires
const BIND_QR_TTL_MS = 5 * 60 * 1000;

// In-memory store for pending bind QR codes (bot_id -> { qrCodeData, expiresAt })
const pendingBinds = new Map<
  string,
  { qrCodeData: string; expiresAt: number }
>();

export function wechatRoutes() {
  const app = new Hono<AppEnv>();

  // GET /wechat/bots — list the user's Hub bots
  app.get("/wechat/bots", async (c) => {
    const hubSession = getCookie(c, "hub_session");
    const userId = c.get("sessionUserId");

    if (!hubSession || !userId) {
      return c.json({ error: "hub not connected" }, 401);
    }

    try {
      const bots = await hubListBots(hubSession);
      return c.json({ bots });
    } catch (err) {
      console.error("hubListBots failed:", err);
      return c.json({ error: "failed to fetch bots" }, 502);
    }
  });

  // POST /wechat/bind/start — start Hub QR-code binding flow
  // Returns { qrCodeUrl, qrCodeData } for Hub to render
  app.post("/wechat/bind/start", async (c) => {
    const hubSession = getCookie(c, "hub_session");
    const userId = c.get("sessionUserId");

    if (!hubSession || !userId) {
      return c.json({ error: "hub not connected" }, 401);
    }

    try {
      const result = await hubStartBotBind(hubSession);
      // qrCodeData is used to confirm the bind later
      pendingBinds.set(userId, {
        qrCodeData: result.qr_code_data,
        expiresAt: Date.now() + BIND_QR_TTL_MS,
      });

      return c.json({ qrCodeUrl: result.qr_code_url });
    } catch (err) {
      console.error("hubStartBotBind failed:", err);
      return c.json({ error: "failed to start binding" }, 502);
    }
  });

  // POST /wechat/bind/confirm — confirm Hub QR-code binding
  // User scans QR in Hub → confirms → we poll Hub for scan result
  // In practice: Hub redirects user to a return URL after scan.
  // This endpoint polls Hub for the scan result using the stored qrCodeData.
  app.post("/wechat/bind/confirm", async (c) => {
    const hubSession = getCookie(c, "hub_session");
    const userId = c.get("sessionUserId");

    if (!hubSession || !userId) {
      return c.json({ error: "hub not connected" }, 401);
    }

    const pending = pendingBinds.get(userId);
    if (!pending || Date.now() > pending.expiresAt) {
      return c.json({ error: "bind expired, please start again" }, 410);
    }

    try {
      // scanResult: the string shown after user scans in Hub
      // In Hub's flow, this comes from the QR scan result URL
      // Here we poll Hub's bind status endpoint
      const bindResult = await hubConfirmBotBind(hubSession, pending.qrCodeData, "scanned");

      pendingBinds.delete(userId);

      // Store channel binding
      replaceActiveChannelBinding({
        userId,
        hubBotId: bindResult.bot_id,
        hubChannelId: bindResult.channel_id,
        hubApiKey: bindResult.api_key,
        now: new Date().toISOString(),
      });

      // Give trial entitlement on first successful bind
      ensureTrialEntitlement(userId);

      return c.json({
        ok: true,
        botId: bindResult.bot_id,
        channelId: bindResult.channel_id,
        botName: bindResult.bot_name,
      });
    } catch (err) {
      console.error("hubConfirmBotBind failed:", err);
      return c.json({ error: "bind confirm failed" }, 502);
    }
  });

  // GET /wechat/binding — check current binding status
  app.get("/wechat/binding", async (c) => {
    const userId = c.get("sessionUserId");
    if (!userId) {
      return c.json({ error: "unauthorized" }, 401);
    }

    const binding = findActiveChannelBindingByUserId(userId);
    if (!binding) {
      return c.json({ bound: false });
    }

    // Optionally verify bot is still online via Hub
    let botStatus: string = "unknown";
    const hubSession = getCookie(c, "hub_session");
    if (hubSession) {
      try {
        botStatus = await hubGetBotStatus(hubSession, binding.hub_bot_id);
      } catch {
        // Hub call failed, don't fail the status check
      }
    }

    return c.json({
      bound: true,
      botId: binding.hub_bot_id,
      channelId: binding.hub_channel_id,
      boundAt: binding.bound_at,
      botStatus,
    });
  });

  // DELETE /wechat/binding — unbind the current channel
  app.delete("/wechat/binding", async (c) => {
    const userId = c.get("sessionUserId");
    if (!userId) {
      return c.json({ error: "unauthorized" }, 401);
    }

    const { deactivateChannelBinding } = await import("../../db/repositories/channel-bindings");
    const binding = findActiveChannelBindingByUserId(userId);
    if (binding) {
      deactivateChannelBinding(binding.id, new Date().toISOString());
    }

    return c.json({ ok: true });
  });

  return app;
}
