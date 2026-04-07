import { config } from "../shared/config";

export function buildBindingSuccessMessage() {
  return "✅ 绑定成功！后续 Four / Flap 发射事件会第一时间推送到这里。";
}

export function buildGenericWechatAutoReply() {
  const msg = "👋 收到消息！\n\n发送 /help 查看全部可用命令\n发送 /plans 查看套餐与价格\n发送 /status 查看订阅状态\n\n查询和狙击功能开发中 🚀";
  return msg;
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

export function buildLaunchMessage(
  tokenAddress: string,
  source: string,
  symbol?: string | null,
  _title?: string | null,
  eventTime?: string | null,
) {
  const sourceLabel = source === "four" ? "Four" : source === "flap" ? "Flap" : source;
  const shortAddr = `${tokenAddress.slice(0, 6)}...${tokenAddress.slice(-4)}`;
  const displayName = symbol || shortAddr;

  const timeStr = eventTime
    ? new Date(eventTime).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false })
    : null;

  const lines: string[] = [];
  lines.push(`🔥 ${displayName}！`);
  lines.push(`📡 来源：${sourceLabel}`);
  if (timeStr) lines.push(`⏰ 时间：${timeStr}`);
  lines.push(``);
  lines.push(`📍 合约：${shortAddr}`);
  lines.push(`DexScreener：https://dexscreener.com/bsc/${tokenAddress}`);
  lines.push(``);
  lines.push(`第一时间掌握机会 👆`);

  return lines.join("\n");
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
    `套餐：月付 0.02 BNB，季付 0.05 BNB，年付 0.1 BNB`,
  ].join("\n");
}
