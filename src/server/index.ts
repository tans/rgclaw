import { runMigrations } from "../db/migrate";
import { createApp } from "./app";
import { hubBootstrapSubscriptions } from "../openilink/hub-ws-service";

runMigrations(process.env.DATABASE_PATH);

const app = createApp();
const port = Number(process.env.PORT ?? 3000);

const server = Bun.serve({
  port,
  fetch: app.fetch,
  idleTimeout: 120, // 增加空闲超时到 120 秒，支持长时间 QR 登录
});

// Bootstrap Hub WS subscriptions for all active channel bindings
hubBootstrapSubscriptions().catch((err) => {
  console.error("[startup] hubBootstrapSubscriptions failed:", err);
});

console.log(
  `[server] listening on http://${server.hostname}:${server.port}`,
);
