import { Hono } from "hono";
import { openDb } from "../../db/sqlite";
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

      return c.html(renderRenewalPage(user?.wallet_address ?? ""));
    } finally {
      db.close();
    }
  });

  return app;
}
