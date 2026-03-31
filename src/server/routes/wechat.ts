import { Hono } from "hono";
import { ensureTrialEntitlement } from "../../db/repositories/entitlements";
import {
  findActiveBindingByConversation,
  replaceActiveWechatBinding,
  touchActiveBindingInbound,
} from "../../db/repositories/wechat-bindings";
import {
  markInboundEventProcessed,
  recordInboundEvent,
} from "../../db/repositories/wechat-inbound-events";
import { config } from "../../shared/config";
import { parseWechatBindCode } from "../../shared/wechat-bind-code";

export function wechatRoutes() {
  const app = new Hono();

  app.post("/wechat/callback", async (c) => {
    const forwardedFor = c.req.header("x-forwarded-for") ?? "";
    const forwardedAddresses = forwardedFor
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean);
    const isAllowed = forwardedAddresses.some((value) =>
      config.wechatCallbackAllowlist.includes(value),
    );

    if (!isAllowed) {
      return c.text("forbidden", 403);
    }

    const body = (await c.req.json()) as Record<string, unknown>;
    const payload = {
      botId: typeof body.botId === "string" ? body.botId.trim() : "",
      fromUserId: typeof body.fromUserId === "string" ? body.fromUserId.trim() : "",
      text: typeof body.text === "string" ? body.text.trim() : "",
      contextToken: typeof body.contextToken === "string" ? body.contextToken.trim() : "",
      messageId: typeof body.messageId === "string" ? body.messageId.trim() : "",
      receivedAt: typeof body.receivedAt === "string" ? body.receivedAt.trim() : new Date().toISOString(),
      rawPayload:
        typeof body.rawPayload === "string"
          ? body.rawPayload
          : JSON.stringify(body.rawPayload ?? body),
    };

    if (!payload.botId || !payload.fromUserId || !payload.messageId) {
      return c.text("invalid payload", 400);
    }

    const isNewEvent = recordInboundEvent(payload);
    if (!isNewEvent) {
      return c.json({ ok: true, duplicate: true });
    }

    touchActiveBindingInbound({
      botId: payload.botId,
      botWechatUserId: payload.fromUserId,
      contextToken: payload.contextToken,
      receivedAt: payload.receivedAt,
    });

    const parsedBindCode = parseWechatBindCode(payload.text, config.wechatBindSecret);
    if (parsedBindCode) {
      replaceActiveWechatBinding({
        userId: parsedBindCode.userId,
        botId: payload.botId,
        botWechatUserId: payload.fromUserId,
        contextToken: payload.contextToken,
        now: payload.receivedAt,
      });
      ensureTrialEntitlement(parsedBindCode.userId);
      markInboundEventProcessed(payload.messageId, "bound");
      return c.json({ ok: true, action: "bound" });
    }

    const binding = findActiveBindingByConversation(payload.botId, payload.fromUserId);
    if (binding) {
      markInboundEventProcessed(payload.messageId, "auto_reply");
      return c.json({ ok: true, action: "auto_reply" });
    }

    markInboundEventProcessed(payload.messageId, "unbound_reply");
    return c.json({ ok: true, action: "unbound_reply" });
  });

  return app;
}
