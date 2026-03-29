export function buildBindInstruction(bindCode: string) {
  return `请在微信机器人中发送绑定码：${bindCode}`;
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
