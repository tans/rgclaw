import { Hono } from "hono";
import { handleBscTransferWebhook } from "../../workers/payment-webhook";
import type { AppEnv } from "../middleware/session";

const WEBHOOK_SECRET = process.env.PAYMENT_WEBHOOK_SECRET ?? "";

export function webhookRoutes() {
  const app = new Hono<AppEnv>();

  // POST /webhook/bsc/transfer — receive BSC transfer notifications
  // Used by blockchain indexers or as a callback from monitoring services
  app.post("/webhook/bsc/transfer", async (c) => {
    // Bearer token auth
    if (WEBHOOK_SECRET) {
      const authHeader = c.req.header("authorization") ?? "";
      const token = authHeader.replace(/^Bearer\s+/i, "").trim();
      if (token !== WEBHOOK_SECRET) {
        return c.json({ ok: false, error: "unauthorized" }, 401);
      }
    }

    const body = await c.req.json<{ txHash?: string }>();
    const txHash = body?.txHash;

    if (!txHash || typeof txHash !== "string") {
      return c.json({ ok: false, error: "missing txHash" }, 400);
    }

    // Basic hex validation
    if (!/^0x[0-9a-fA-F]{64}$/.test(txHash)) {
      return c.json({ ok: false, error: "invalid txHash format" }, 400);
    }

    const result = await handleBscTransferWebhook(txHash);

    // Return 200 even for business failures (e.g. wrong wallet) to avoid indexer retries
    return c.json(result, 200);
  });

  return app;
}
