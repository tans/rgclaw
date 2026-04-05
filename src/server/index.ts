import { runMigrations } from "../db/migrate";
import { createApp } from "./app";
import { bootstrapDirectWeChatBots } from "../services/wechatbot-service";

console.log("[startup] Starting regouapp-web...");
console.log("[startup] PORT:", process.env.PORT);
console.log("[startup] DATABASE_PATH:", process.env.DATABASE_PATH);

console.log("[startup] Running migrations...");
runMigrations(process.env.DATABASE_PATH);
console.log("[startup] Migrations done");

console.log("[startup] Creating app...");
const app = createApp();
console.log("[startup] App created");

const port = Number(process.env.PORT ?? 3000);
console.log(`[startup] Starting Bun.serve on port ${port}...`);

const server = Bun.serve({
  port,
  fetch: app.fetch,
  idleTimeout: 120,
});

console.log(`[startup] Bun.serve started, hostname=${server.hostname}, port=${server.port}`);

// Bootstrap direct WeChat bots for all active bindings
bootstrapDirectWeChatBots().catch((err) => {
  console.error("[startup] bootstrapDirectWeChatBots failed:", err);
});

console.log(
  `[server] listening on http://${server.hostname}:${server.port}`,
);
