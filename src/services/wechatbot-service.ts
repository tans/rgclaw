import { WeChatBot } from "@wechatbot/wechatbot";
import type { WechatBotBinding } from "../db/repositories/wechat-bot-bindings";

// 存储活跃的 Bot 实例
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

// 内存中存储临时 QR 绑定状态
const qrStatusStore = new Map<string, QRCodeStatus>();

const QR_EXPIRY_MS = 5 * 60 * 1000; // 5分钟过期

export async function startQRLogin(userId: string): Promise<{ qrCodeUrl: string; qrToken: string }> {
  const bot = new WeChatBot();
  
  return new Promise((resolve, reject) => {
    let resolved = false;
    
    // 设置超时
    const timeout = setTimeout(() => {
      if (!resolved) {
        qrStatusStore.set(userId, { status: "expired", error: "QR code expired" });
        reject(new Error("QR code expired"));
      }
    }, QR_EXPIRY_MS);
    
    // @ts-ignore - SDK API may differ
    bot.login({
      // @ts-ignore
      onQRCode: (qrCodeUrl: string, qrToken: string) => {
        if (resolved) return;
        resolved = true;
        clearTimeout(timeout);
        
        qrStatusStore.set(userId, {
          status: "pending",
          qrCodeUrl,
          qrToken,
        });
        
        resolve({ qrCodeUrl, qrToken });
      },
      // @ts-ignore
      onScanned: () => {
        const current = qrStatusStore.get(userId);
        if (current) {
          qrStatusStore.set(userId, { ...current, status: "scanned" });
        }
      },
      // @ts-ignore
      onConfirmed: (credentials: {
        token: string;
        botId: string;
        accountId: string;
        userId: string;
        baseUrl: string;
      }) => {
        const current = qrStatusStore.get(userId);
        if (current) {
          qrStatusStore.set(userId, {
            ...current,
            status: "confirmed",
            credentials: {
              botToken: credentials.token,
              botId: credentials.botId,
              accountId: credentials.accountId,
              userWxId: credentials.userId,
              baseUrl: credentials.baseUrl,
            },
          });
        }
        
        // @ts-ignore
        bot.stop?.();
      },
      // @ts-ignore
      onError: (error: Error) => {
        if (!resolved) {
          resolved = true;
          clearTimeout(timeout);
          reject(error);
        } else {
          qrStatusStore.set(userId, { status: "error", error: error.message });
        }
      },
    });
  });
}

export function getQRStatus(userId: string): QRCodeStatus | undefined {
  return qrStatusStore.get(userId);
}

export function clearQRStatus(userId: string): void {
  qrStatusStore.delete(userId);
}

export function startBotForBinding(binding: WechatBotBinding): void {
  if (activeBots.has(binding.id)) {
    return;
  }
  
  // @ts-ignore - SDK constructor options
  const bot = new WeChatBot({
    baseUrl: binding.base_url,
    token: binding.bot_token,
    botId: binding.bot_id,
  });
  
  activeBots.set(binding.id, bot);
  
  // @ts-ignore
  bot.start();
}

export function stopBotForBinding(bindingId: string): void {
  const bot = activeBots.get(bindingId);
  if (bot) {
    // @ts-ignore
    bot.stop?.();
    activeBots.delete(bindingId);
  }
}

export function stopAllBots(): void {
  for (const [bindingId, bot] of activeBots) {
    // @ts-ignore
    bot.stop?.();
    activeBots.delete(bindingId);
  }
}

export async function sendMessage(
  binding: WechatBotBinding,
  toUserId: string,
  content: string
): Promise<void> {
  // @ts-ignore - SDK constructor options
  const bot = new WeChatBot({
    baseUrl: binding.base_url,
    token: binding.bot_token,
    botId: binding.bot_id,
  });
  
  // @ts-ignore
  await bot.send(toUserId, content);
}

export function getActiveBot(bindingId: string): WeChatBot | undefined {
  return activeBots.get(bindingId);
}
