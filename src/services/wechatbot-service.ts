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
const QR_GENERATION_TIMEOUT_MS = 25 * 1000; // 25秒生成超时（给前端留5秒buffer）

// 获取二维码（不等待扫码完成）
export function getQRCode(userId: string): { qrCodeUrl: string; qrToken: string } | null {
  const status = qrStatusStore.get(userId);
  if (status && status.status === "pending" && status.qrCodeUrl) {
    return { qrCodeUrl: status.qrCodeUrl, qrToken: status.qrToken || "" };
  }
  return null;
}

// 启动 QR 登录流程（立即返回二维码）
export async function startQRLogin(userId: string): Promise<{ qrCodeUrl: string; qrToken: string }> {
  // 检查是否已有进行中的登录
  const existingStatus = qrStatusStore.get(userId);
  if (existingStatus && existingStatus.qrCodeUrl && existingStatus.status === "pending") {
    return { qrCodeUrl: existingStatus.qrCodeUrl, qrToken: existingStatus.qrToken || "" };
  }

  // 清除之前的状态
  qrStatusStore.delete(userId);

  // 创建带超时的 QR 生成 Promise
  return new Promise<{ qrCodeUrl: string; qrToken: string }>((resolve, reject) => {
    let resolved = false;
    let bot: WeChatBot | null = null;

    // 设置生成超时（25秒）
    const generationTimeout = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        qrStatusStore.set(userId, { status: "error", error: "QR code generation timeout" });
        try {
          (bot as any)?.stop?.();
        } catch {
          // ignore
        }
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
      onQRCode: (qrCodeUrl: string, qrToken: string) => {
        if (resolved) return;
        resolved = true;
        clearTimeout(generationTimeout);
        qrStatusStore.set(userId, { status: "pending", qrCodeUrl, qrToken });
        resolve({ qrCodeUrl, qrToken });
      },
      onScanned: () => {
        const current = qrStatusStore.get(userId);
        if (current) {
          qrStatusStore.set(userId, { ...current, status: "scanned" });
        }
      },
      onConfirmed: (credentials: { token: string; botId: string; accountId: string; userId: string; baseUrl: string; }) => {
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
        (bot as any)?.stop?.();
      },
      onError: (error: Error) => {
        clearTimeout(generationTimeout);
        if (resolved) return;
        resolved = true;
        qrStatusStore.set(userId, { status: "error", error: error.message });
        (bot as any)?.stop?.();
        reject(error);
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
  const bot = new WeChatBot({
    baseUrl: binding.base_url,
    token: binding.bot_token,
    botId: binding.bot_id,
  } as any);
  activeBots.set(binding.id, bot);
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
