import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { runMigrations } from "../../src/db/migrate";
import { openDb } from "../../src/db/sqlite";

const testDbPath = "/tmp/rgclaw-migrate-test.sqlite";

describe("runMigrations", () => {
  beforeEach(() => {
    try {
      rmSync(testDbPath);
    } catch {}
  });

  afterEach(() => {
    try {
      rmSync(testDbPath);
    } catch {}
  });

  test("创建一期核心表", () => {
    runMigrations(testDbPath);
    const db = openDb(testDbPath);
    const row = db
      .query("select name from sqlite_master where type = 'table' and name = 'launch_events'")
      .get() as { name: string } | null;

    expect(row?.name).toBe("launch_events");
  });
});
