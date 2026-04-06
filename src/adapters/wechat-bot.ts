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

export function buildLaunchMessage(tokenAddress: string, source: string, symbol?: string | null, title?: string | null) {
  const sourceLabel = source === "four" ? "Four" : source === "flap" ? "Flap" : source;
  const shortAddr = `${tokenAddress.slice(0, 6)}...${tokenAddress.slice(-4)}`;
  const displayName = symbol || shortAddr;
  const headline = title ? `🔥 ${sourceLabel} 发射：${title}` : `🔥 ${sourceLabel} 发射！`;
  return [
    headline,
    ``,
    `代币: ${displayName}`,
    `合约: ${shortAddr}`,
    `DexScreener: https://dexscreener.com/bsc/${tokenAddress}`,
    ``,
    `第一时间掌握发射机会 👆`,
  ].join("\n");
}

export function buildRenewalReminder(expiresAt: string) {
  return [
    "⏰ 推送服务即将到期",
    "",
    `到期时间：${expiresAt}`,
    "到期后发射推送将中断，不再收到 Four / Flap 通知。",
    "",
    "立即续费，不中断推送：",
    "👉 regou.app/renew",
    "",
    `套餐：月付 0.005 BNB，年付 0.045 BNB（省 25%）`,
  ].join("\n");
}
