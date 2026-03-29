import { readFileSync } from "node:fs";
import { openDb } from "./sqlite";

export function runMigrations(path?: string) {
  const db = openDb(path);
  const sql = readFileSync(new URL("./schema.sql", import.meta.url), "utf8");
  db.exec(sql);
}

if (import.meta.main) {
  runMigrations(process.argv[2]);
  console.log("migrations complete");
}
