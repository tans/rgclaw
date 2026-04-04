import { runMigrations } from "../db/migrate";
import { createApp } from "./app";

runMigrations(process.env.DATABASE_PATH);

const app = createApp();
const port = Number(process.env.PORT ?? 3000);

const server = Bun.serve({
  port,
  fetch: app.fetch,
});

console.log(
  `[server] listening on http://${server.hostname}:${server.port}`,
);
