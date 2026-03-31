import { Hono } from "hono";
import {
  buildBindingSuccessMessage,
  buildGenericWechatAutoReply,
  buildUnboundWechatReply,
  sendWechatMessage,
} from "../../adapters/wechat-bot";
import { ensureTrialEntitlement } from "../../db/repositories/entitlements";
import { createSystemMessageJob } from "../../db/repositories/notification-jobs";
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
    const clientIp = forwardedFor.split(",")[0]?.trim() ?? "";
    const isAllowed = Boolean(clientIp) && config.wechatCallbackAllowlist.includes(clientIp);

    if (!isAllowed) {
      return c.text("forbidden", 403);
    }

    let body: Record<string, unknown>;
    try {
      const parsed = await c.req.json();
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        return c.text("invalid payload", 400);
      }
      body = parsed as Record<string, unknown>;
    } catch {
      return c.text("invalid payload", 400);
    }

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

    const inboundEvent = recordInboundEvent(payload);
    if (!inboundEvent.shouldProcess) {
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
      createSystemMessageJob({
        userId: parsedBindCode.userId,
        messageType: "binding_success",
        payload: buildBindingSuccessMessage(),
      });
      markInboundEventProcessed(payload.messageId, "bound");
      return c.json({ ok: true, action: "bound" });
    }

    const binding = findActiveBindingByConversation(payload.botId, payload.fromUserId);
    if (binding) {
      createSystemMessageJob({
        userId: binding.user_id,
        messageType: "auto_reply",
        payload: buildGenericWechatAutoReply(),
      });
      markInboundEventProcessed(payload.messageId, "auto_reply");
      return c.json({ ok: true, action: "auto_reply" });
    }

    if (payload.contextToken) {
      try {
        await sendWechatMessage({
          botId: payload.botId,
          toUserId: payload.fromUserId,
          contextToken: payload.contextToken,
          text: buildUnboundWechatReply(),
        });
      } catch {
        // Unbound replies are best-effort and should not block callback acknowledgement.
      }
    }

    markInboundEventProcessed(payload.messageId, "unbound_reply");
    return c.json({ ok: true, action: "unbound_reply" });
  });

  return app;
}
