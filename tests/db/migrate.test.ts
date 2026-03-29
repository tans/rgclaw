import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { runMigrations } from "../../src/db/migrate";
import { openDb } from "../../src/db/sqlite";

const testDbPath = "/tmp/rgclaw-migrate-test.sqlite";
const testDefaultBaseDir = "/tmp/rgclaw-migrate-default";
const originalCwd = process.cwd();
const originalDatabasePath = process.env.DATABASE_PATH;

describe("runMigrations", () => {
  beforeEach(() => {
    try {
      rmSync(testDbPath);
    } catch {}
    try {
      rmSync(testDefaultBaseDir, { recursive: true, force: true });
    } catch {}
    process.chdir(originalCwd);
    process.env.DATABASE_PATH = originalDatabasePath;
  });

  afterEach(() => {
    try {
      rmSync(testDbPath);
    } catch {}
    try {
      rmSync(testDefaultBaseDir, { recursive: true, force: true });
    } catch {}
    process.chdir(originalCwd);
    process.env.DATABASE_PATH = originalDatabasePath;
  });

  test("创建一期核心表", () => {
    runMigrations(testDbPath);
    const db = openDb(testDbPath);
    const row = db
      .query("select name from sqlite_master where type = 'table' and name = 'launch_events'")
      .get() as { name: string } | null;

    expect(row?.name).toBe("launch_events");
  });

  test("默认路径可自举创建 data 目录", () => {
    mkdirSync(testDefaultBaseDir, { recursive: true });
    process.chdir(testDefaultBaseDir);
    delete process.env.DATABASE_PATH;

    runMigrations();

    expect(existsSync("./data/app.sqlite")).toBe(true);
    const db = openDb("./data/app.sqlite");
    const row = db
      .query("select name from sqlite_master where type = 'table' and name = 'launch_events'")
      .get() as { name: string } | null;

    expect(row?.name).toBe("launch_events");
  });

  test("重复执行 migration 不会重复写记录", () => {
    runMigrations(testDbPath);
    runMigrations(testDbPath);

    const db = openDb(testDbPath);
    const row = db
      .query("select count(*) as count from _migrations where id = ?")
      .get("0001_initial_schema") as { count: number };

    expect(row.count).toBe(1);
  });

  test("migration 在记账前失败时会整体回滚", () => {
    const migrationId = "0002_atomicity_test";

    expect(() =>
      runMigrations(testDbPath, {
        migrations: [
          {
            id: migrationId,
            sql: "create table tx_atomicity_probe (id text primary key);",
          },
        ],
        beforeRecordMigration: () => {
          throw new Error("before record failed");
        },
      }),
    ).toThrow("before record failed");

    const db = openDb(testDbPath);
    const createdTable = db
      .query("select name from sqlite_master where type = 'table' and name = 'tx_atomicity_probe'")
      .get() as { name: string } | null;
    const migrationRecord = db
      .query("select count(*) as count from _migrations where id = ?")
      .get(migrationId) as { count: number };

    expect(createdTable).toBeNull();
    expect(migrationRecord.count).toBe(0);
  });
});
