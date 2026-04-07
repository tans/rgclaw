import { WeChatBot } from "@wechatbot/wechatbot";
import { listLatestLaunchEvents } from "../db/repositories/launch-events";
import { getActiveEntitlement } from "../db/repositories/entitlements";
import { listSubscriptions, setSubscriptionState } from "../db/repositories/subscriptions";
import { getAllActiveBindings, type WechatBotBinding, updateLastMessageTime } from "../db/repositories/wechat-bot-bindings";

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

const AUTO_REPLY_MESSAGE = "收到！发送 /help 查看全部可用命令，/start 重新显示欢迎信息。";

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

/start — 重新显示欢迎信息
/status — 查看订阅状态
/sub four — 开启 Four 推送
/sub flap — 开启 Flap 推送
/unsub four — 关闭 Four 推送
/unsub flap — 关闭 Flap 推送
/history — 查看最近发射记录
/bnb — 查询 BNB 当前价格
/ping — 机器人在线检测
/test — 发送测试消息
/trial — 查看试用到期时间
/plans — 查看套餐与价格
/upgrade · /renew — 立即前往续费页
/help — 显示此帮助`;
}

function buildStartText(entitlement: { plan_type: string; expires_at: string } | null): string {
  const hasSub = !!entitlement;
  if (hasSub) {
    const expiresAt = new Date(entitlement!.expires_at);
    const now = Date.now();
    const remainingMs = expiresAt.getTime() - now;
    const remainingDays = Math.max(0, Math.ceil(remainingMs / (1000 * 60 * 60 * 24)));
    const isTrial = entitlement!.plan_type === "trial";
    const subLine = isTrial
      ? `📋 您的订阅状态：试用（剩余 ${remainingDays} 天）\n\n开通付费版即可持续接收 Four / Flap 代币发射推送。\n前往 regou.app 购买专业版。`
      : `📋 您的订阅状态：${entitlement!.plan_type === "pro" ? "专业版" : entitlement!.plan_type}\n\nFour / Flap 代币发射推送已开启。`;
    return `👋 欢迎回来！\n\n您已绑定 regou.app，发射事件推送已开启。\n\n${subLine}\n\n当前可用命令：\n/start — 显示此消息\n/status — 查看订阅状态\n/sub four · /sub flap — 管理推送\n/history — 查看发射记录\n/bnb — 查询 BNB 价格\n/plans — 查看套餐与价格\n/upgrade — 立即续费\n/help — 全部命令\n\n有疑问？前往 regou.app 查看完整说明。`;
  }
  return `👋 欢迎使用 regou.app！\n\n您已成功绑定微信，当前为试用用户。\n\n📋 您的订阅状态：试用\n\n开通付费版即可持续接收 Four / Flap 代币发射推送。\n前往 regou.app 购买专业版，或发送 /upgrade 立即查看套餐。\n\n当前可用命令：\n/start — 显示此消息\n/plans — 查看套餐与价格\n/upgrade — 立即续费\n/help — 全部命令`;
}

function planLabel(planType: string): string {
  if (planType === "trial") return "试用";
  if (planType === "pro" || planType === "pro_monthly") return "专业版（月付）";
  if (planType === "pro_yearly") return "专业版（年付）";
  return planType;
}

function buildStatusText(entitlement: { plan_type: string; expires_at: string }, userId: string): string {
  const plan = planLabel(entitlement.plan_type);
  const expires = new Date(entitlement.expires_at).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" });
  const subs = listSubscriptions(userId);
  const fourOn = subs.find(s => s.source === "four")?.enabled === 1;
  const flapOn = subs.find(s => s.source === "flap")?.enabled === 1;
  const isTrial = entitlement.plan_type === "trial";
  let expiryLine = `到期: ${expires}`;
  if (isTrial) {
    const remainingMs = new Date(entitlement.expires_at).getTime() - Date.now();
    const remainingDays = Math.max(0, Math.ceil(remainingMs / (1000 * 60 * 60 * 24)));
    expiryLine += `（剩余 ${remainingDays} 天）`;
  }
  return `📋 订阅状态\n\n套餐: ${plan}\n${expiryLine}\n\nFour 推送: ${fourOn ? "✅ 开启" : "❌ 关闭"}\nFlap 推送: ${flapOn ? "✅ 开启" : "❌ 关闭"}\n\n${isTrial ? "⚡ 试用即将到期？续费后推送不中断！\n" : ""}输入 /plans 查看套餐，输入 /upgrade 立即续费。`;
}

function buildToggleResult(source: string, newState: boolean): string {
  const label = source === "four" ? "Four" : "Flap";
  return `${label} 推送已${newState ? "开启" : "关闭"} ✅`;
}

async function buildPlansText(): Promise<string> {
  const bnbPrice = await fetchBnbPrice();
  const monthlyUsd = bnbPrice != "暂时无法获取" ? `（约 $${(Number(bnbPrice.replace("$","").replace(" USDT","")) * 0.02).toFixed(2)}）` : "";
  const quarterlyUsd = bnbPrice != "暂时无法获取" ? `（约 $${(Number(bnbPrice.replace("$","").replace(" USDT","")) * 0.05).toFixed(2)}）` : "";
  const yearlyUsd = bnbPrice != "暂时无法获取" ? `（约 $${(Number(bnbPrice.replace("$","").replace(" USDT","")) * 0.1).toFixed(2)}）` : "";
  return `💳 Regou 套餐

⭐ 年付 0.1 BNB${yearlyUsd}（365 天）— 推荐
季付 0.05 BNB${quarterlyUsd}（90 天）
月付 0.02 BNB${monthlyUsd}（30 天）

✅ 付款后自动上链检测并续期，不中断推送

👉 regou.app/renew`;
}

function buildUpgradeText(): string {
  return `🚀 立即升级到专业版

⭐ 年付 0.1 BNB（365 天）— 推荐
季付 0.05 BNB（90 天）
月付 0.02 BNB（30 天）

前往续费：https://regou.app/renew

付款后自动上链检测并续期，不中断 Four / Flap 推送。`;
}

function buildHistoryText(userId: string): string {
  const events = listLatestLaunchEvents(5);
  if (events.length === 0) return "暂无发射记录";
  const subs = listSubscriptions(userId);
  const lines = events.map(ev => {
    const label = ev.source === "four" ? "Four" : ev.source === "flap" ? "Flap" : ev.source;
    const time = new Date(ev.event_time).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
    const shortAddr = `${ev.token_address.slice(0, 6)}...${ev.token_address.slice(-4)}`;
    return `🔥 ${label} — ${ev.title}\n代币: ${ev.symbol || shortAddr}\n合约: ${shortAddr}\nDexScreener: https://dexscreener.com/bsc/${ev.token_address}\n${time}`;
  });
  return `📜 最近发射记录\n\n${lines.join("\n\n")}`;
}

function buildUnknownCommand(cmd: string): string {
  return `未知命令: /${cmd}\n\n输入 /help 查看可用命令，或 /start 重新显示欢迎信息`;
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
    updateLastMessageTime(binding.id);

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

      if (cmd === "start") {
        const hasSub = !!entitlement;
        await bot.reply(msg, buildStartText(entitlement));
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

        case "test":
        case "测试": {
          // 发送测试消息验证 bot 是否正常工作
          await bot.reply(msg, `📤 测试消息

机器人状态: ✅ 在线
绑定账号: ${binding.user_id.slice(0, 8)}...
推送服务: 正常

如果收到此消息，说明推送通道正常。`);
          return;
        }

        case "trial":
        case "试用": {
          if (!entitlement) {
            await bot.reply(msg, "你还没有订阅体验。\n\n立即开始试用：\n👉 regou.app");
            return;
          }
          const expiresAt = new Date(entitlement.expires_at);
          const remainingMs = expiresAt.getTime() - Date.now();
          const remainingDays = Math.max(0, Math.ceil(remainingMs / (1000 * 60 * 60 * 24)));
          const remainingHours = Math.max(0, Math.ceil(remainingMs / (1000 * 60 * 60)));
          const countdown = remainingDays > 0 ? remainingDays + " 天" : remainingHours > 0 ? remainingHours + " 小时" : "即将到期";
          const label = entitlement.plan_type === "trial" ? "试用" : "订阅";
          const isTrial = entitlement.plan_type === "trial";
          const msgText = "⏰ " + label + "剩余时间：" + countdown + "\n\n" + (isTrial ? "试用到期后推送将中断，新的发射事件不再推送。\n\n立即升级，不中断推送体验：\n" : "当前订阅状态正常。\n") + "👉 regou.app/renew\n\n套餐：月付 0.02 BNB，季付 0.05 BNB，年付 0.1 BNB";
          await bot.reply(msg, msgText);
          return;
        }

        case "sub":
        case "订阅": {
          const source = args[0];
          if (source !== "four" && source !== "flap") {
            await bot.reply(msg, "用法: /sub four 或 /sub flap");
            return;
          }
          setSubscriptionState(binding.user_id, source, true);
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
          setSubscriptionState(binding.user_id, source, false);
          await bot.reply(msg, buildToggleResult(source, false));
          return;
        }

        case "history":
        case "历史":
          await bot.reply(msg, buildHistoryText(binding.user_id));
          return;

        case "ping":
        case "pong": {
          await bot.reply(msg, `✅ 机器人正常运行！`);
          return;
        }

        case "bnb":
        case "bnb价格": {
          const price = await fetchBnbPrice();
          await bot.reply(msg, `🪙 BNB 当前价格\n\n${price}\n\n数据来源: Binance`);
          return;
        }

        case "plans":
        case "套餐":
          await bot.reply(msg, await buildPlansText());
          return;

        case "upgrade":
        case "renew":
        case "续费":
          await bot.reply(msg, buildUpgradeText());
          return;

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

export function setQRStatusForTesting(userId: string, status: QRCodeStatus): void {
  qrStatusStore.set(userId, status);
}

export function startBotForBinding(binding: WechatBotBinding): Promise<void> {
  if (activeBots.has(binding.id)) return Promise.resolve();

  // Per-binding storage so each bot's credentials are isolated
  const storageDir = `/root/.wechatbot/${binding.id}`;

  // Pre-populate credentials at per-binding path using data from DB.
  // This avoids relying on the SDK's QR login flow to store credentials at the right place.
  // The SDK's FileStorage stores credentials at {storageDir}/credentials.json.
  const { mkdirSync, writeFileSync } = require("fs");
  mkdirSync(storageDir, { recursive: true, mode: 0o700 });
  const creds = {
    token: binding.bot_token,
    baseUrl: binding.base_url,
    accountId: binding.bot_id,
    userId: binding.user_wx_id,
    savedAt: new Date().toISOString(),
  };
  writeFileSync(`${storageDir}/credentials.json`, JSON.stringify(creds, null, 2) + "\n", { mode: 0o600 });

  const bot = new WeChatBot({
    baseUrl: binding.base_url,
    token: binding.bot_token,
    botId: binding.bot_id,
    storage: "file",
    storageDir,
  } as any);

  const messageHandler = makeMessageHandler(bot, binding);

  (bot as any).onMessage(async (msg: any) => {
    try {
      await messageHandler(msg);
    } catch (err) {
      console.error("Auto-reply failed:", err);
    }
  });

  return new Promise<void>((resolve, reject) => {
    (bot as any).login()
      .then(() => {
        activeBots.set(binding.id, bot);
        console.log(`[wechatbot] bot ${binding.id} logged in, starting WebSocket...`);
        (bot as any).start().catch((err: unknown) => {
          console.warn(`[wechatbot] bot ${binding.id} WebSocket error:`, err instanceof Error ? err.message : String(err));
        });
        resolve();
      })
      .catch(async (err: unknown) => {
        const errMsg = err instanceof Error ? err.message : String(err);
        console.warn(`[wechatbot] bot ${binding.id} login failed (${errMsg}), clearing stale creds...`);
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
    throw new Error(`WECHAT_BOT_INACTIVE:Bot session inactive or expired for binding ${binding.id}. Please re-bind your WeChat at regou.app`);
  }

  // Load context_token for the bot's own userId from the shared context store.
  // Per-binding storage has no context_tokens.json, so we load from the shared dir.
  const SHARED_CONTEXT_PATH = "/root/.wechatbot/context_tokens.json";
  let contextToken: string | undefined;
  try {
    const { readFileSync } = require("fs");
    const tokens = JSON.parse(readFileSync(SHARED_CONTEXT_PATH, "utf-8")) as Record<string, string>;
    // The context token is stored under the bot's own userId
    contextToken = tokens[binding.user_wx_id];
  } catch {}

  if (!contextToken) {
    throw new Error(`WECHAT_BOT_INACTIVE:No context token found. Please send a message to the bot first, then try again.`);
  }

  // Use bot.send() which includes context_token in the payload.
  const SEND_TIMEOUT_MS = 10_000;
  await Promise.race([
    (bot as any).send(toUserId, content),
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
