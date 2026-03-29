import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

export function openDb(path = process.env.DATABASE_PATH ?? "./data/app.sqlite") {
  if (path !== ":memory:") {
    mkdirSync(dirname(path), { recursive: true });
  }
  return new Database(path, { create: true });
}
