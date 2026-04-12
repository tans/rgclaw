#!/usr/bin/env bun
import { openDb } from "../src/db/sqlite";

const db = openDb();

console.log("清空事件数据...");

const tables = [
  "notification_jobs",
  "launch_events",
];

for (const table of tables) {
  const countBefore = db.query(`SELECT COUNT(*) as count FROM ${table}`).get() as { count: number };
  console.log(`${table}: ${countBefore.count} 条记录`);

  db.run(`DELETE FROM ${table}`);

  const countAfter = db.query(`SELECT COUNT(*) as count FROM ${table}`).get() as { count: number };
  console.log(`${table}: 已清空 (剩余 ${countAfter.count} 条)`);
}

db.close();
console.log("✓ 完成");
