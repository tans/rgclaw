#!/usr/bin/env bun
// diagnose-push.ts - 诊断推送系统为什么没有创建任务

import { openDb } from "../src/db/sqlite";

const db = openDb();

console.log("=== Push System Diagnosis ===\n");

// 1. 检查最近的 launch events
console.log("1. Recent Launch Events:");
const events = db.query(`
  SELECT id, source, token_address, symbol,
         datetime(event_time, '+8 hours') as event_time_local,
         datetime(created_at, '+8 hours') as created_at_local
  FROM launch_events
  ORDER BY created_at DESC
  LIMIT 5
`).all();
console.table(events);

// 2. 检查用户状态
console.log("\n2. User Status:");
const users = db.query(`
  SELECT
    u.id as user_id,
    ue.status as entitlement_status,
    datetime(ue.expires_at) as expires_at_utc,
    datetime(ue.expires_at, '+8 hours') as expires_at_beijing,
    CASE WHEN datetime(ue.expires_at) > datetime('now') THEN 'VALID' ELSE 'EXPIRED' END as validity,
    wb.id as wechat_binding_id,
    wb.status as wechat_status
  FROM users u
  LEFT JOIN user_entitlements ue ON ue.user_id = u.id
  LEFT JOIN wechat_bot_bindings wb ON wb.user_id = u.id
`).all();
console.table(users);

// 3. 检查订阅状态
console.log("\n3. Subscription Status:");
const subs = db.query(`
  SELECT user_id, source, enabled
  FROM user_source_subscriptions
  ORDER BY user_id, source
`).all();
console.table(subs);

// 4. 模拟 processLaunchPushes 查询
console.log("\n4. Simulating processLaunchPushes Query:");
const eligible = db.query(`
  SELECT DISTINCT
    launch_events.id as launch_event_id,
    users.id as user_id,
    launch_events.source,
    launch_events.symbol,
    user_source_subscriptions.enabled as sub_enabled,
    user_entitlements.status as ent_status,
    datetime(user_entitlements.expires_at) as expires_at,
    CASE WHEN datetime(user_entitlements.expires_at) > datetime('now') THEN 'YES' ELSE 'NO' END as not_expired,
    (SELECT COUNT(*) FROM wechat_bot_bindings wb WHERE wb.user_id = users.id AND wb.status = 'active') as has_wechat
  FROM launch_events
  JOIN user_source_subscriptions
    ON user_source_subscriptions.source = launch_events.source
   AND user_source_subscriptions.enabled = 1
  JOIN users ON users.id = user_source_subscriptions.user_id
  JOIN user_entitlements
    ON user_entitlements.user_id = users.id
   AND user_entitlements.status = 'active'
  WHERE datetime(user_entitlements.expires_at) > datetime('now')
    AND NOT EXISTS (
      SELECT 1 FROM notification_jobs
      WHERE notification_jobs.launch_event_id = launch_events.id
        AND notification_jobs.user_id = users.id
    )
  ORDER BY launch_events.created_at DESC
  LIMIT 10
`).all();

console.log(`Found ${eligible.length} eligible push candidates (before wechat check):`);
console.table(eligible);

// 5. 检查为什么没有通过 wechat 检查
console.log("\n5. Checking WeChat Binding Requirement:");
const withWechat = db.query(`
  SELECT DISTINCT
    launch_events.id as launch_event_id,
    users.id as user_id,
    launch_events.source,
    launch_events.symbol
  FROM launch_events
  JOIN user_source_subscriptions
    ON user_source_subscriptions.source = launch_events.source
   AND user_source_subscriptions.enabled = 1
  JOIN users ON users.id = user_source_subscriptions.user_id
  JOIN user_entitlements
    ON user_entitlements.user_id = users.id
   AND user_entitlements.status = 'active'
  WHERE datetime(user_entitlements.expires_at) > datetime('now')
    AND NOT EXISTS (
      SELECT 1 FROM notification_jobs
      WHERE notification_jobs.launch_event_id = launch_events.id
        AND notification_jobs.user_id = users.id
    )
    AND EXISTS (
      SELECT 1 FROM wechat_bot_bindings wb
      WHERE wb.user_id = users.id AND wb.status = 'active'
    )
  ORDER BY launch_events.created_at DESC
  LIMIT 10
`).all();

console.log(`Found ${withWechat.length} eligible push candidates (after wechat check):`);
console.table(withWechat);

// 6. 总结问题
console.log("\n=== Summary ===");
console.log(`Total events: ${events.length}`);
console.log(`Total users: ${users.length}`);
console.log(`Eligible before wechat check: ${eligible.length}`);
console.log(`Eligible after wechat check: ${withWechat.length}`);

if (withWechat.length === 0 && eligible.length > 0) {
  console.log("\n⚠️ ISSUE: Users have subscriptions but no active WeChat bindings!");
}

db.close();
