import { Database } from "bun:sqlite";

export function openDb(path = process.env.DATABASE_PATH ?? "./data/app.sqlite") {
  return new Database(path, { create: true });
}
