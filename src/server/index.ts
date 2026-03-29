import { runMigrations } from "../db/migrate";
import { createApp } from "./app";

runMigrations(process.env.DATABASE_PATH);

const app = createApp();

export default {
  port: Number(process.env.PORT ?? 3000),
  fetch: app.fetch,
};
