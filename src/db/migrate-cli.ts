// 纯迁移脚本：运行所有 pending migrations，然后退出
// 用法: bun run src/db/migrate-cli.ts
import { runMigrations } from "./migrate";
import { config } from "../shared/config";

const dbPath = process.env.DATABASE_PATH ?? config.databasePath;
console.log(`[migrate] running on ${dbPath}`);
runMigrations(dbPath);
console.log("[migrate] done");
