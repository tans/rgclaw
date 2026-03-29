import { Hono } from "hono";
import { runMigrations } from "../db/migrate";
import { listLatestLaunchEvents } from "../db/repositories/launch-events";
import { sessionMiddleware, type AppEnv } from "./middleware/session";
import { authRoutes } from "./routes/auth";
import { renderHomePage } from "./views/home";

export function createApp() {
  runMigrations(process.env.DATABASE_PATH);
  const app = new Hono<AppEnv>();

  app.use("*", sessionMiddleware);

  app.get("/", (ctx) => {
    return ctx.html(renderHomePage(listLatestLaunchEvents()));
  });

  app.route("/", authRoutes());

  app.get("/me", (ctx) => {
    const sessionUserId = ctx.get("sessionUserId");
    if (!sessionUserId) {
      return ctx.redirect("/", 302);
    }

    return ctx.html(
      `<!DOCTYPE html><html><head><meta charset="utf-8"/><title>用户中心</title></head><body><main><h1>用户中心</h1></main></body></html>`
    );
  });

  return app;
}
