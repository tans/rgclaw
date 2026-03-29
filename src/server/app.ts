import { Hono } from "hono";
import { runMigrations } from "../db/migrate";
import { listLatestLaunchEvents } from "../db/repositories/launch-events";
import { sessionMiddleware, type AppEnv } from "./middleware/session";
import { authRoutes } from "./routes/auth";
import { userCenterRoutes } from "./routes/user-center";
import { wechatRoutes } from "./routes/wechat";
import { renderHomePage } from "./views/home";

export function createApp() {
  runMigrations(process.env.DATABASE_PATH);
  const app = new Hono<AppEnv>();

  app.use("*", sessionMiddleware);

  app.get("/", (ctx) => {
    return ctx.html(renderHomePage(listLatestLaunchEvents()));
  });

  app.route("/", authRoutes());
  app.route("/", userCenterRoutes());
  app.route("/", wechatRoutes());

  return app;
}
