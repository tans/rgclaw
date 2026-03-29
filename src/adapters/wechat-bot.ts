export function buildBindInstruction(bindCode: string) {
  return `请在微信机器人中发送绑定码：${bindCode}`;
}

export async function sendWechatMessage(_wechatUserId: string, _content: string) {
  return { ok: true };
}
