import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

export function openDb(path = process.env.DATABASE_PATH ?? "./data/app.sqlite") {
  if (path !== ":memory:") {
    mkdirSync(dirname(path), { recursive: true });
  }
  const db = new Database(path, { create: true }) as any;
  // WAL mode allows concurrent reads while writing
  db.exec("PRAGMA journal_mode = WAL;");
  // Wait up to 5s when database is locked by another writer (e.g. worker)
  db.busyTimeout = 5_000;
  return db;
}
