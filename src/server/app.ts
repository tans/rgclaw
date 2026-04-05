import { Hono } from "hono";
import { runMigrations } from "../db/migrate";
import { listLatestLaunchEvents } from "../db/repositories/launch-events";
import { sessionMiddleware, type AppEnv } from "./middleware/session";
import { authRoutes } from "./routes/auth";
import { renewalRoutes } from "./routes/renewal";
import { userCenterRoutes } from "./routes/user-center";
import { webhookRoutes } from "./routes/webhook";
import { wechatRoutes } from "./routes/wechat";
import { wechatDirectRoutes } from "./routes/wechat-direct";
import { eventsRoutes } from "./routes/events";
import { renderHomePage } from "./views/home";

export function createApp() {
  runMigrations(process.env.DATABASE_PATH);

  const app = new Hono<AppEnv>();

  // Webhook routes first — no session cookie needed (bearer token auth)
  app.route("/", webhookRoutes());
  
  // Public API routes — no session needed
  app.route("/", eventsRoutes());

  app.use("*", sessionMiddleware);

  app.get("/", (ctx) => {
    return ctx.html(renderHomePage(listLatestLaunchEvents()));
  });

  app.route("/", authRoutes());
  app.route("/", userCenterRoutes());
  app.route("/", renewalRoutes());
  app.route("/", wechatRoutes());
  app.route("/", wechatDirectRoutes());

  return app;
}
