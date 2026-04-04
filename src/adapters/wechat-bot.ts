import { config } from "../shared/config";

export function buildBindingSuccessMessage() {
  return "✅ 绑定成功！后续 Four / Flap 发射事件会第一时间推送到这里。";
}

export function buildGenericWechatAutoReply() {
  return "查询和狙击功能开发中，敬请期待 🚀";
}

export function buildUnboundWechatReply() {
  return "请先完成微信绑定才能使用此功能";
}

export function buildKeepaliveReminder() {
  return "👋 你的微信通知通道还在，回复任意消息保持活跃。";
}

type SendWechatMessageInput = {
  botId: string;
  toUserId: string;
  text: string;
  contextToken?: string | null;
};

/**
 * @deprecated This calls the removed WeClawBot-API. Use Hub channel send via openilink/client instead.
 */
export async function sendWechatMessage(input: SendWechatMessageInput) {
  const baseUrl = config.wechatBotApiBaseUrl.replace(/\/+$/, "");
  const endpoint = `${baseUrl}/bots/${encodeURIComponent(input.botId)}/messages`;
  const payload: Record<string, string> = {
    text: input.text,
    toUserId: input.toUserId,
  };

  if (input.contextToken) {
    payload.contextToken = input.contextToken;
  }

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      authorization: `Bearer ${config.wechatBotApiToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const body = (await response.text()).trim();
    throw new Error(`wechat send failed (${response.status}): ${body || "empty response"}`);
  }

  return { ok: true };
}

export function buildLaunchMessage(title: string, tokenAddress: string, source: string) {
  const sourceLabel = source === "four" ? "Four" : source === "flap" ? "Flap" : source;
  return `🔥 ${sourceLabel} 发射\n\n${title}\n\n合约: ${tokenAddress}\n\n< https://dexscreener.com/bsc/${tokenAddress} >`;
}

export function buildRenewalReminder(expiresAt: string) {
  return `⏰ 你的推送服务将于 ${expiresAt} 到期。续费后不中断服务，继续享受 Four / Flap 第一时间通知。`;
}
