import { Hono } from "hono";
import { getCookie } from "hono/cookie";
import { openDb } from "../../db/sqlite";
import { getActiveEntitlement } from "../../db/repositories/entitlements";
import { upsertWalletAddress } from "../../db/repositories/subscriptions";
import type { AppEnv } from "../middleware/session";
import { renderRenewalPage } from "../views/renewal";

type RenewalUserRecord = {
  wallet_address: string | null;
};

export function renewalRoutes() {
  const app = new Hono<AppEnv>();

  app.get("/renew", (c) => {
    const userId = c.get("sessionUserId");
    if (!userId) {
      return c.redirect("/", 302);
    }

    const db = openDb();

    try {
      const user = db
        .query("select wallet_address from users where id = ?")
        .get(userId) as RenewalUserRecord | null;

      const entitlement = getActiveEntitlement(userId);

      return c.html(renderRenewalPage({
        walletAddress: user?.wallet_address ?? "",
        entitlementExpiresAt: entitlement?.expires_at ?? null,
        planType: entitlement?.plan_type ?? null,
      }));
    } finally {
      db.close();
    }
  });

  // POST /renew — handle wallet address update from renewal page
  app.post("/renew", async (c) => {
    const userId = c.get("sessionUserId");
    if (!userId) {
      return c.redirect("/", 302);
    }

    const body = await c.req.parseBody();
    const walletAddress = body.walletAddress;

    if (typeof walletAddress === "string" && walletAddress.trim()) {
      upsertWalletAddress(userId, walletAddress.trim());
    }

    return c.redirect("/renew", 302);
  });

  return app;
}
