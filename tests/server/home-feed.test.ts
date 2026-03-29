import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { openDb } from "../../src/db/sqlite";
import { runMigrations } from "../../src/db/migrate";
import { createApp } from "../../src/server/app";

function setupHomeFeedTestDb() {
  const dir = mkdtempSync(join(tmpdir(), "rgclaw-home-feed-"));
  const dbPath = join(dir, "app.sqlite");
  process.env.DATABASE_PATH = dbPath;
  runMigrations(dbPath);

  return {
    dbPath,
    cleanup() {
      rmSync(dir, { recursive: true, force: true });
      delete process.env.DATABASE_PATH;
    },
  };
}

describe("homepage feed", () => {
  test("GET / 按事件时间倒序展示最新发射事件", async () => {
    const { dbPath, cleanup } = setupHomeFeedTestDb();
    const db = openDb(dbPath);

    try {
      db.query(
        "insert into launch_events (id, source, source_event_id, token_address, symbol, title, event_time, chain, raw_payload, dedupe_key, created_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      ).run(
        "evt-older",
        "four",
        "source-older",
        "0xolder",
        "OLD",
        "OLD 发射",
        "2026-03-29T08:00:00.000Z",
        "bsc",
        "{}",
        "four:tx-older:0",
        "2026-03-29T08:00:00.000Z",
      );

      db.query(
        "insert into launch_events (id, source, source_event_id, token_address, symbol, title, event_time, chain, raw_payload, dedupe_key, created_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      ).run(
        "evt-newer",
        "flap",
        "source-newer",
        "0xnewer",
        "DOG",
        "DOG 发射",
        "2026-03-29T09:00:00.000Z",
        "bsc",
        "{}",
        "flap:tx-newer:0",
        "2026-03-29T09:00:00.000Z",
      );

      const app = createApp();
      const res = await app.request("http://localhost/");
      const html = await res.text();

      expect(res.status).toBe(200);
      expect(html).toContain("DOG 发射");
      expect(html).toContain("OLD 发射");
      expect(html).toContain("flap");
      expect(html.indexOf("DOG 发射")).toBeLessThan(html.indexOf("OLD 发射"));
    } finally {
      db.close();
      cleanup();
    }
  });
});
