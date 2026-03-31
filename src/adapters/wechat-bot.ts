import { config } from "../shared/config";

export function buildBindInstruction(bindCode: string) {
  return `请把以下绑定码发送给任意一个已登录的微信机器人：${bindCode}`;
}

export function buildBindingSuccessMessage() {
  return "绑定成功，后续通知会通过这个微信发送。";
}

export function buildGenericWechatAutoReply() {
  return "查询和狙击功能开发中";
}

export function buildUnboundWechatReply() {
  return "请先发送绑定码完成绑定";
}

export function buildKeepaliveReminder() {
  return "为保持通知能力，请回复任意消息。";
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

export function buildLaunchMessage(title: string, tokenAddress: string) {
  return `${title}\n${tokenAddress}`;
}

export function buildRenewalReminder(expiresAt: string) {
  return `你的推送权益将在 ${expiresAt} 到期，请及时续费。`;
}
