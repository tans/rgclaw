#!/usr/bin/env bun
// enable-subscriptions.ts - 为指定用户启用所有订阅

import { openDb } from "../src/db/sqlite";

const userId = process.argv[2];

if (!userId) {
  console.error("Usage: bun run scripts/enable-subscriptions.ts <user_id>");
  process.exit(1);
}

const db = openDb();

try {
  // 启用所有订阅
  const result = db.query(`
    UPDATE user_source_subscriptions
    SET enabled = 1, updated_at = ?
    WHERE user_id = ?
  `).run(new Date().toISOString(), userId);

  console.log(`✅ Enabled ${result.changes} subscriptions for user ${userId}`);

  // 显示当前状态
  const subs = db.query(`
    SELECT source, enabled
    FROM user_source_subscriptions
    WHERE user_id = ?
  `).all(userId);

  console.log("\nCurrent subscriptions:");
  console.table(subs);
} finally {
  db.close();
}
