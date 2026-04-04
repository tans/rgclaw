import { Hono } from "hono";
import { openDb } from "../../db/sqlite";
import { getActiveEntitlement } from "../../db/repositories/entitlements";
import {
  ensureDefaultSubscriptions,
  listSubscriptions,
  upsertWalletAddress,
} from "../../db/repositories/subscriptions";
import { findActiveChannelBindingByUserId } from "../../db/repositories/channel-bindings";
import type { AppEnv } from "../middleware/session";
import { renderUserCenter } from "../views/user-center";

type UserCenterUserRecord = {
  email: string;
  wallet_address: string | null;
};

export function userCenterRoutes() {
  const app = new Hono<AppEnv>();

  app.get("/me", (c) => {
    const userId = c.get("sessionUserId");
    if (!userId) {
      return c.redirect("/", 302);
    }

    ensureDefaultSubscriptions(userId);

    const db = openDb();

    try {
      const user = db
        .query("select email, wallet_address from users where id = ?")
        .get(userId) as UserCenterUserRecord | null;
      const entitlement = getActiveEntitlement(userId);
      const subscriptions = listSubscriptions(userId);

      // Check new Hub-based channel binding
      const hubBinding = findActiveChannelBindingByUserId(userId);

      // Detect ?bound=1 from successful WeChat bind redirect
      const justBound = c.req.query("bound") === "1";

      // Calculate trial days left
      let trialDaysLeft: number | undefined;
      if (entitlement?.plan_type === "trial") {
        const expiresAt = new Date(entitlement.expires_at).getTime();
        const now = Date.now();
        trialDaysLeft = Math.ceil((expiresAt - now) / (1000 * 60 * 60 * 24));
      }

      return c.html(
        renderUserCenter({
          email: user?.email ?? "",
          walletAddress: user?.wallet_address ?? "",
          subscriptions,
          entitlementText: entitlement
            ? `${entitlement.expires_at}（${entitlement.plan_type === "trial" ? "3 天试用" : "付费"}）`
            : "暂无",
          bindingStatusText: hubBinding ? "已绑定（Hub）" : "未绑定",
          bound: !!hubBinding,
          justBound,
          trialDaysLeft,
        }),
      );
    } finally {
      db.close();
    }
  });

  app.post("/me/wallet", async (c) => {
    const userId = c.get("sessionUserId");
    if (!userId) {
      return c.text("unauthorized", 401);
    }

    const body = await c.req.parseBody();
    const walletAddress = body.walletAddress;

    if (typeof walletAddress !== "string") {
      return c.text("invalid wallet", 400);
    }

    upsertWalletAddress(userId, walletAddress.trim());

    return c.redirect("/me", 302);
  });

  return app;
}
