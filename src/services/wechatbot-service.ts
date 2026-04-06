import { WeChatBot } from "@wechatbot/wechatbot";
import { listLatestLaunchEvents } from "../db/repositories/launch-events";
import { getActiveEntitlement } from "../db/repositories/entitlements";
import { listSubscriptions, toggleSubscription } from "../db/repositories/subscriptions";
import { getAllActiveBindings, type WechatBotBinding } from "../db/repositories/wechat-bot-bindings";

const activeBots = new Map<string, WeChatBot>();

export type QRCodeStatus = {
  status: "pending" | "scanned" | "confirmed" | "expired" | "error";
  qrCodeUrl?: string;
  qrToken?: string;
  credentials?: {
    botToken: string;
    botId: string;
    accountId: string;
    userWxId: string;
    baseUrl: string;
  };
  error?: string;
};

const qrStatusStore = new Map<string, QRCodeStatus>();

const QR_GENERATION_TIMEOUT_MS = 60 * 1000;

const AUTO_REPLY_MESSAGE = "发射事件监听已开启，更多功能开发中。";

async function fetchBnbPrice(): Promise<string> {
  try {
    const res = await fetch("https://api.binance.com/api/v3/ticker/price?symbol=BNBUSDT");
    if (!res.ok) throw new Error("binance api error");
    const data = (await res.json()) as { price: string };
    const price = Number(data.price).toFixed(2);
    return `$${price} USDT`;
  } catch {
    return "暂时无法获取";
  }
};

// ─── Command reply builders ────────────────────────────────────────────────

function buildHelpText(): string {
  return `📖 regou.app 命令帮助

/status — 查看订阅状态
/sub four — 开启 Four 推送
/sub flap — 开启 Flap 推送
/unsub four — 关闭 Four 推送
/unsub flap — 关闭 Flap 推送
/history — 查看最近发射记录
/bnb — 查询 BNB 当前价格
/help — 显示此帮助`;
}

function buildStatusText(entitlement: { plan_type: string; expires_at: string }, userId: string): string {
  const plan = entitlement.plan_type === "trial" ? "试用" : entitlement.plan_type === "pro" ? "专业版" : entitlement.plan_type;
  const expires = new Date(entitlement.expires_at).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" });
  const subs = listSubscriptions(userId);
  const fourOn = subs.find(s => s.source === "four")?.enabled === 1;
  const flapOn = subs.find(s => s.source === "flap")?.enabled === 1;
  return `📋 订阅状态\n\n套餐: ${plan}\n到期: ${expires}\n\nFour 推送: ${fourOn ? "✅ 开启" : "❌ 关闭"}\nFlap 推送: ${flapOn ? "✅ 开启" : "❌ 关闭"}`;
}

function buildToggleResult(source: string, newState: boolean): string {
  const label = source === "four" ? "Four" : "Flap";
  return `${label} 推送已${newState ? "开启" : "关闭"} ✅`;
}

function buildHistoryText(userId: string): string {
  const events = listLatestLaunchEvents(5);
  if (events.length === 0) return "暂无发射记录";
  const subs = listSubscriptions(userId);
  const lines = events.map(ev => {
    const label = ev.source === "four" ? "Four" : ev.source === "flap" ? "Flap" : ev.source;
    const time = new Date(ev.event_time).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
    return `🔥 ${label} — ${ev.title}\n合约: ${ev.token_address}\n${time}`;
  });
  return `📜 最近发射记录\n\n${lines.join("\n\n")}`;
}

function buildUnknownCommand(cmd: string): string {
  return `未知命令: /${cmd}\n\n输入 /help 查看可用命令`;
}

function buildNotBoundText(): string {
  return "⚠️ 未绑定账号，请先到 regou.app 绑定微信";
}

function buildNoSubscriptionText(): string {
  return "⚠️ 暂无有效订阅，请到 regou.app 购买";
}

// ─── Message handler with command parsing ───────────────────────────────────

function makeMessageHandler(bot: any, binding: WechatBotBinding): (msg: any) => Promise<void> {
  return async (msg: any) => {
    if (msg.type !== "text" || !msg.text || msg.isFromSelf) return;

    const entitlement = getActiveEntitlement(binding.user_id);
    const text = (msg.text || "").trim();

    // Check if it's a command
    if (text.startsWith("/")) {
      const parts = text.slice(1).split(/\s+/);
      const cmd = (parts[0] || "").toLowerCase();
      const args: string[] = parts.slice(1).map((a: string) => a.toLowerCase());

      // Commands that work without subscription check
      if (cmd === "help" || cmd === "帮助") {
        await bot.reply(msg, buildHelpText());
        return;
      }

      // All other commands require an active subscription
      if (!entitlement) {
        await bot.reply(msg, buildNoSubscriptionText());
        return;
      }

      switch (cmd) {
        case "status":
        case "状态":
          await bot.reply(msg, buildStatusText(entitlement, binding.user_id));
          return;

        case "sub":
        case "订阅": {
          const source = args[0];
          if (source !== "four" && source !== "flap") {
            await bot.reply(msg, "用法: /sub four 或 /sub flap");
            return;
          }
          toggleSubscription(binding.user_id, source);
          await bot.reply(msg, buildToggleResult(source, true));
          return;
        }

        case "unsub":
        case "取消订阅": {
          const source = args[0];
          if (source !== "four" && source !== "flap") {
            await bot.reply(msg, "用法: /unsub four 或 /unsub flap");
            return;
          }
          toggleSubscription(binding.user_id, source);
          await bot.reply(msg, buildToggleResult(source, false));
          return;
        }

        case "history":
        case "历史":
          await bot.reply(msg, buildHistoryText(binding.user_id));
          return;

        case "bnb":
        case "bnb价格": {
          const price = await fetchBnbPrice();
          await bot.reply(msg, `🪙 BNB 当前价格\n\n${price}\n\n数据来源: Binance`);
          return;
        }

        default:
          await bot.reply(msg, buildUnknownCommand(cmd));
          return;
      }
    }

    // Fallback: non-command text
    await bot.reply(msg, AUTO_REPLY_MESSAGE);
  };
};

export function getQRCode(userId: string): { qrCodeUrl: string; qrToken: string } | null {
  const status = qrStatusStore.get(userId);
  if (status && status.status === "pending" && status.qrCodeUrl) {
    return { qrCodeUrl: status.qrCodeUrl, qrToken: status.qrToken || "" };
  }
  return null;
}

/**
 * Force QR login — skips stored credentials, goes straight to QR code generation.
 * Used as fallback when the first QR attempt times out.
 */
function forceQRLogin(userId: string): Promise<{ qrCodeUrl: string; qrToken: string }> {
  return new Promise((resolve, reject) => {
    let resolved = false;
    let bot: WeChatBot | null = null;
    const timeout = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        try { (bot as any)?.stop?.(); } catch {}
        reject(new Error("QR code generation failed after retry. Please try again in a few minutes."));
      }
    }, QR_GENERATION_TIMEOUT_MS);
    try {
      bot = new WeChatBot();
    } catch (error) {
      clearTimeout(timeout);
      reject(new Error(`Failed to initialize WeChatBot: ${error instanceof Error ? error.message : String(error)}`));
      return;
    }
    (bot as any).login({
      force: true,
      callbacks: {
        onQrUrl: (qrUrl: string) => {
          if (resolved) return;
          resolved = true;
          clearTimeout(timeout);
          const tokenMatch = qrUrl.match(/[?&]qrcode=([^&]+)/);
          const qrToken = tokenMatch ? tokenMatch[1] : "";
          qrStatusStore.set(userId, { status: "pending", qrCodeUrl: qrUrl, qrToken });
          resolve({ qrCodeUrl: qrUrl, qrToken });
        },
        onExpired: () => {
          // QR expired during retry — the qrLogin loop will request a new one
        },
      },
    }).catch((error: Error) => {
      if (!resolved) {
        resolved = true;
        clearTimeout(timeout);
        try { (bot as any)?.stop?.(); } catch {}
        reject(new Error(`QR login failed: ${error.message}`));
      }
    });
  });
}

export async function startQRLogin(userId: string): Promise<{ qrCodeUrl: string; qrToken: string }> {
  const existingStatus = qrStatusStore.get(userId);
  if (existingStatus && existingStatus.qrCodeUrl && existingStatus.status === "pending") {
    return { qrCodeUrl: existingStatus.qrCodeUrl, qrToken: existingStatus.qrToken || "" };
  }

  qrStatusStore.delete(userId);

  return new Promise<{ qrCodeUrl: string; qrToken: string }>((resolve, reject) => {
    let resolved = false;
    let bot: WeChatBot | null = null;

    const generationTimeout = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        qrStatusStore.set(userId, { status: "error", error: "QR code generation timeout, retrying..." });
        try { (bot as any)?.stop?.(); } catch {}

        // Retry once — skip stored creds, force fresh QR login
        clearQRStatus(userId);
        forceQRLogin(userId).then(resolve).catch(reject);
      }
    }, QR_GENERATION_TIMEOUT_MS);

    try {
      bot = new WeChatBot();
    } catch (error) {
      clearTimeout(generationTimeout);
      if (!resolved) {
        resolved = true;
        const errorMsg = error instanceof Error ? error.message : String(error);
        qrStatusStore.set(userId, { status: "error", error: errorMsg });
        reject(new Error(`Failed to initialize WeChatBot: ${errorMsg}`));
      }
      return;
    }

    (bot as any).login({
      force: true,
      callbacks: {
        onQrUrl: (qrUrl: string) => {
          if (resolved) return;
          resolved = true;
          clearTimeout(generationTimeout);
          
          const tokenMatch = qrUrl.match(/[?&]qrcode=([^&]+)/);
          const qrToken = tokenMatch ? tokenMatch[1] : "";
          
          qrStatusStore.set(userId, { status: "pending", qrCodeUrl: qrUrl, qrToken });
          resolve({ qrCodeUrl: qrUrl, qrToken });
        },
        onScanned: () => {
          const current = qrStatusStore.get(userId);
          if (current) {
            qrStatusStore.set(userId, { ...current, status: "scanned" });
          }
        },
        onExpired: () => {
          const current = qrStatusStore.get(userId);
          if (current && !resolved) {
            qrStatusStore.set(userId, { ...current, status: "expired", error: "QR code expired" });
          }
        },
      }
    }).then((creds: any) => {
      const current = qrStatusStore.get(userId);
      if (current) {
        qrStatusStore.set(userId, {
          ...current,
          status: "confirmed",
          credentials: {
            botToken: creds.token,
            botId: creds.accountId,
            accountId: creds.accountId,
            userWxId: creds.userId,
            baseUrl: creds.baseUrl,
          },
        });
      }
      try { (bot as any)?.stop?.(); } catch {}
    }).catch((error: Error) => {
      clearTimeout(generationTimeout);
      const current = qrStatusStore.get(userId);
      if (current) {
        qrStatusStore.set(userId, { ...current, status: "error", error: error.message });
      }
      try { (bot as any)?.stop?.(); } catch {}
    });
  });
}

export function getQRStatus(userId: string): QRCodeStatus | undefined {
  return qrStatusStore.get(userId);
}

export function clearQRStatus(userId: string): void {
  qrStatusStore.delete(userId);
}

export function startBotForBinding(binding: WechatBotBinding): Promise<void> {
  if (activeBots.has(binding.id)) return Promise.resolve();

  // Use per-binding storage so each bot's credentials are isolated
  const storageDir = `/root/.wechatbot/${binding.id}`;

  const bot = new WeChatBot({
    baseUrl: binding.base_url,
    token: binding.bot_token,
    botId: binding.bot_id,
    storage: "file",
    storageDir,
  } as any);

  const messageHandler = makeMessageHandler(bot, binding);

  // Set up auto-reply for incoming messages
  (bot as any).onMessage(async (msg: any) => {
    try {
      await messageHandler(msg);
    } catch (err) {
      console.error("Auto-reply failed:", err);
    }
  });

  // login() restores session from FileStorage (~/.wechatbot/) if credentials were
  // previously saved during QR bind. Only add bot to activeBots AFTER login succeeds.
  // If login fails (timeout, expired creds, etc.) the stored creds are invalid —
  // delete them so the user can re-bind via QR code without stale state interfering.
  return new Promise<void>((resolve, reject) => {
    (bot as any).login()
      .then(() => {
        activeBots.set(binding.id, bot);
        console.log(`[wechatbot] bot ${binding.id} logged in, starting WebSocket...`);
        // start() in background — don't block the caller
        (bot as any).start().catch((err: unknown) => {
          console.warn(`[wechatbot] bot ${binding.id} WebSocket error:`, err instanceof Error ? err.message : String(err));
        });
        resolve();
      })
      .catch(async (err: unknown) => {
        const errMsg = err instanceof Error ? err.message : String(err);
        console.warn(`[wechatbot] bot ${binding.id} login failed (${errMsg}), clearing stale creds...`);
        // Delete stale storage so re-bind works cleanly
        try {
          const { existsSync, rmSync } = require("fs");
          if (existsSync(storageDir)) {
            rmSync(storageDir, { recursive: true, force: true });
          }
        } catch {}
        // Reject so bootstrap counts it as failed — caller should mark binding as needing re-bind
        reject(new Error(`Bot login failed: ${errMsg}. Please re-bind your WeChat at regou.app`));
      });
  });
}

export function stopBotForBinding(bindingId: string): void {
  const bot = activeBots.get(bindingId);
  if (bot) {
    (bot as any).stop?.();
    activeBots.delete(bindingId);
  }
}

export async function deleteBotStorage(bindingId: string): Promise<void> {
  const bot = activeBots.get(bindingId);
  if (bot) {
    await (bot as any).stop?.();
    activeBots.delete(bindingId);
  }
  const storageDir = `/root/.wechatbot/${bindingId}`;
  try {
    const { existsSync, rmSync } = require("fs");
    if (existsSync(storageDir)) {
      rmSync(storageDir, { recursive: true, force: true });
    }
  } catch {}
}

export function stopAllBots(): void {
  for (const [bindingId, bot] of Array.from(activeBots.entries())) {
    (bot as any).stop?.();
    activeBots.delete(bindingId);
  }
}

export async function sendMessage(
  binding: WechatBotBinding,
  toUserId: string,
  content: string
): Promise<void> {
  const bot = activeBots.get(binding.id);
  if (!bot) {
    // Bot not in activeBots — either still starting, login failed, or session expired.
    // Throw a specific error so the caller can distinguish this from network errors.
    throw new Error(`WECHAT_BOT_INACTIVE:Bot session inactive or expired for binding ${binding.id}. Please re-bind your WeChat at regou.app`);
  }
  // sendRaw sends via /ilink/bot/sendmessage without contextToken check.
  // msg shape: { from_user_id, to_user_id, client_id, message_type, message_state, item_list }
  // Wrap in a timeout so a dead WebSocket doesn't hang the dispatch loop forever.
  const SEND_TIMEOUT_MS = 10_000;
  await Promise.race([
    (bot as any).sendRaw({ to_user_id: toUserId, item_list: [{ type: "text", text: { text: content } }] }),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error("WECHAT_BOT_INACTIVE:Message send timed out. Bot may be disconnected.")), SEND_TIMEOUT_MS)
    ),
  ]);
}

export function getActiveBot(bindingId: string): WeChatBot | undefined {
  return activeBots.get(bindingId);
}

/**
 * Bootstrap WebSocket subscriptions for all active WeChat bot bindings.
 * Call once on server startup to restore in-memory bot state.
 *
 * Note: WeChatBot WebSocket sessions cannot survive server restarts.
 * If startBotForBinding fails (Not logged in), the binding remains in the
 * database but the user needs to re-bind via QR code to restore auto-reply.
 */
export async function bootstrapDirectWeChatBots() {
  const bindings = getAllActiveBindings();
  let started = 0;
  let failed = 0;
  for (const binding of bindings) {
    try {
      await startBotForBinding(binding);
      started++;
    } catch (err) {
      failed++;
      console.warn(`[startup] failed to start bot for binding ${binding.id}, user may need to re-bind:`, err instanceof Error ? err.message : String(err));
    }
  }
  console.log(`[startup] bootstrapped ${started}/${bindings.length} direct WeChat bots (${failed} failed - may need re-bind)`);
}
