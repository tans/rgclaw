export function buildBindInstruction(bindCode: string) {
  return `请把以下绑定码发送给任意一个已登录的微信机器人：${bindCode}`;
}

export async function sendWechatMessage(_wechatUserId: string, _content: string) {
  return { ok: true };
}

export function buildLaunchMessage(title: string, tokenAddress: string) {
  return `${title}\n${tokenAddress}`;
}

export function buildRenewalReminder(expiresAt: string) {
  return `你的推送权益将在 ${expiresAt} 到期，请及时续费。`;
}
