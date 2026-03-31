import { createHmac, timingSafeEqual } from "node:crypto";

function buildWechatBindSignature(userId: string, secret: string) {
  return createHmac("sha256", secret).update(`uid:${userId}`).digest("hex");
}

export function buildWechatBindCode(userId: string, secret: string) {
  return `uid:${userId}:${buildWechatBindSignature(userId, secret)}`;
}

export function parseWechatBindCode(text: string, secret: string) {
  const trimmed = text.trim();
  const prefix = "uid:";

  if (!trimmed.startsWith(prefix)) {
    return null;
  }

  const lastSeparatorIndex = trimmed.lastIndexOf(":");
  if (lastSeparatorIndex <= prefix.length) {
    return null;
  }

  const userId = trimmed.slice(prefix.length, lastSeparatorIndex);
  const signature = trimmed.slice(lastSeparatorIndex + 1);
  if (!userId || !signature) {
    return null;
  }

  const expectedSignature = buildWechatBindSignature(userId, secret);
  const actualBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expectedSignature);

  if (actualBuffer.length !== expectedBuffer.length) {
    return null;
  }

  if (!timingSafeEqual(actualBuffer, expectedBuffer)) {
    return null;
  }

  return { userId };
}
