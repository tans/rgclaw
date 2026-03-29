import { Hono } from "hono";
import { ensureTrialEntitlement } from "../../db/repositories/entitlements";
import { completeBinding } from "../../db/repositories/wechat-bindings";

export function wechatRoutes() {
  const app = new Hono();

  app.post("/wechat/callback", async (c) => {
    const body = (await c.req.json()) as { bindCode?: unknown; wechatUserId?: unknown };
    const bindCode = typeof body.bindCode === "string" ? body.bindCode.trim() : "";
    const wechatUserId = typeof body.wechatUserId === "string" ? body.wechatUserId.trim() : "";

    if (!bindCode || !wechatUserId) {
      return c.text("invalid payload", 400);
    }

    const result = completeBinding(bindCode, wechatUserId);
    if (!result) {
      return c.text("bind code not found", 404);
    }

    ensureTrialEntitlement(result.user_id);

    return c.json({ ok: true });
  });

  return app;
}
