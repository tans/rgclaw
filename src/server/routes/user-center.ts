import { Hono } from "hono";
import { openDb } from "../../db/sqlite";
import { getActiveEntitlement } from "../../db/repositories/entitlements";
import { ensureDefaultSubscriptions, listSubscriptions, upsertWalletAddress, toggleSubscription, } from "../../db/repositories/subscriptions";
import { findActiveBindingByUserId } from "../../db/repositories/wechat-bot-bindings";
import { listLatestLaunchEvents } from "../../db/repositories/launch-events";
import { sendMessage, getActiveBot } from "../../services/wechatbot-service";
import type { AppEnv } from "../middleware/session";
import { renderUserCenter } from "../views/user-center";

type UserCenterUserRecord = {
  wallet_address: string | null;
};

export function userCenterRoutes() {
  const app = new Hono<AppEnv>();

  app.get("/me", (c) => {
    const userId = c.get("sessionUserId");
    if (!userId) {
      return c.redirect("/", 302);
    }

    ensureDefaultSubscriptions(userId);
    const db = openDb();
    try {
      const user = db
        .query("select wallet_address from users where id = ?")
        .get(userId) as UserCenterUserRecord | null;

      const entitlement = getActiveEntitlement(userId);
      const subscriptions = listSubscriptions(userId);
      const recentEvents = listLatestLaunchEvents(10);

      const directBinding = findActiveBindingByUserId(userId);

      const justBound = c.req.query("bound") === "1";
      const showNewUserMessageReminder = !!directBinding && !directBinding.last_message_at;

      let trialDaysLeft: number | undefined;
      if (entitlement?.plan_type === "trial") {
        const expiresAt = new Date(entitlement.expires_at).getTime();
        const now = Date.now();
        trialDaysLeft = Math.ceil((expiresAt - now) / (1000 * 60 * 60 * 24));
      }

      let bindingStatusText: string;
      const isBound = !!directBinding;

      if (directBinding) {
        bindingStatusText = "已绑定（微信）";
      } else {
        bindingStatusText = "未绑定";
      }

      return c.html(
        renderUserCenter({
          walletAddress: user?.wallet_address ?? "",
          subscriptions,
          recentEvents,
          entitlementText: entitlement
            ? entitlement.plan_type === "trial"
              ? trialDaysLeft !== undefined && trialDaysLeft >= 0
                ? `试用中（剩余 ${trialDaysLeft} 天）`
                : "试用已到期"
              : "付费"
            : "暂无",
          bindingStatusText,
          bound: isBound,
          justBound,
          showNewUserMessageReminder,
          trialDaysLeft,
        }),
      );
    } finally {
      db.close();
    }
  });

  app.post("/me/wallet", async (c) => {
    const userId = c.get("sessionUserId");
    if (!userId) {
      return c.text("unauthorized", 401);
    }
    const body = await c.req.parseBody();
    const walletAddress = body.walletAddress;
    if (typeof walletAddress !== "string") {
      return c.text("invalid wallet", 400);
    }
    upsertWalletAddress(userId, walletAddress.trim());
    return c.redirect("/me", 302);
  });

  app.post("/me/subscription/toggle", async (c) => {
    const userId = c.get("sessionUserId");
    if (!userId) {
      return c.text("unauthorized", 401);
    }
    const body = await c.req.parseBody();
    const source = body.source;
    if (typeof source !== "string" || !["four", "flap"].includes(source)) {
      return c.text("invalid source", 400);
    }
    toggleSubscription(userId, source);
    return c.redirect("/me", 302);
  });

  const EMOJIS = ["😀", "😂", "🥳", "🎉", "🔥", "🚀", "💪", "❤️", "👍", "🎯", "✨", "🌟", "💎", "🍀", "🎪"];

  app.post("/me/send-message", async (c) => {
    const userId = c.get("sessionUserId");
    if (!userId) {
      return c.text("unauthorized", 401);
    }
    const binding = findActiveBindingByUserId(userId);
    if (!binding) {
      return c.json({ error: "未绑定微信" }, 400);
    }
    const emoji = EMOJIS[Math.floor(Math.random() * EMOJIS.length)];
    try {
      await sendMessage(binding, binding.user_wx_id, emoji);
      return c.json({ ok: true, emoji });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("send message failed:", msg);
      if (msg.startsWith("WECHAT_BOT_INACTIVE:")) {
        return c.json({ error: "微信机器人已离线，请重新绑定" }, 409);
      }
      return c.json({ error: msg }, 500);
    }
  });

  // GET /me/bot-status — returns whether the user's WeChat bot is online
  app.get("/me/bot-status", async (c) => {
    const userId = c.get("sessionUserId");
    if (!userId) {
      return c.json({ error: "unauthorized" }, 401);
    }
    const binding = findActiveBindingByUserId(userId);
    if (!binding) {
      return c.json({ bound: false, online: false });
    }
    const bot = getActiveBot(binding.id);
    return c.json({ bound: true, online: !!bot, type: "wechat" });
  });

  return app;
}
