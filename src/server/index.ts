import { runMigrations } from "../db/migrate";
import { createApp } from "./app";
import { hubBootstrapSubscriptions } from "../openilink/hub-ws-service";
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
  idleTimeout: 120, // 增加空闲超时到 120 秒，支持长时间 QR 登录
});

console.log(`[startup] Bun.serve started, hostname=${server.hostname}, port=${server.port}`);

// Bootstrap Hub WS subscriptions for all active channel bindings
hubBootstrapSubscriptions().catch((err) => {
  console.error("[startup] hubBootstrapSubscriptions failed:", err);
});

// Bootstrap direct WeChat bots for all active bindings
bootstrapDirectWeChatBots().catch((err) => {
  console.error("[startup] bootstrapDirectWeChatBots failed:", err);
});

console.log(
  `[server] listening on http://${server.hostname}:${server.port}`,
);
