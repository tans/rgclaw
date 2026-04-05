import { WeChatBot } from "@wechatbot/wechatbot";
import type { WechatBotBinding } from "../db/repositories/wechat-bot-bindings";

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

const QR_GENERATION_TIMEOUT_MS = 25 * 1000;

const AUTO_REPLY_MESSAGE = "发射事件监听已开启，更多功能开发中。";

export function getQRCode(userId: string): { qrCodeUrl: string; qrToken: string } | null {
  const status = qrStatusStore.get(userId);
  if (status && status.status === "pending" && status.qrCodeUrl) {
    return { qrCodeUrl: status.qrCodeUrl, qrToken: status.qrToken || "" };
  }
  return null;
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
        qrStatusStore.set(userId, { status: "error", error: "QR code generation timeout" });
        try { (bot as any)?.stop?.(); } catch {}
        reject(new Error("QR code generation timeout"));
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

export function startBotForBinding(binding: WechatBotBinding): void {
  if (activeBots.has(binding.id)) return;
  
  const bot = new WeChatBot({
    baseUrl: binding.base_url,
    token: binding.bot_token,
    botId: binding.bot_id,
  } as any);
  
  activeBots.set(binding.id, bot);
  
  // Set up auto-reply for incoming messages
  (bot as any).onMessage(async (msg: any) => {
    try {
      // Only reply to text messages and avoid replying to our own messages
      if (msg.text && !msg.isFromSelf) {
        await (bot as any).reply(msg, AUTO_REPLY_MESSAGE);
      }
    } catch (err) {
      console.error("Auto-reply failed:", err);
    }
  });
  
  (bot as any).start();
}

export function stopBotForBinding(bindingId: string): void {
  const bot = activeBots.get(bindingId);
  if (bot) {
    (bot as any).stop?.();
    activeBots.delete(bindingId);
  }
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
  const bot = new WeChatBot({
    baseUrl: binding.base_url,
    token: binding.bot_token,
    botId: binding.bot_id,
  } as any);
  await (bot as any).send(toUserId, content);
}

export function getActiveBot(bindingId: string): WeChatBot | undefined {
  return activeBots.get(bindingId);
}
