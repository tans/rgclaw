import { readFileSync } from "node:fs";
import { openDb } from "./sqlite";

const migrations = [
  {
    id: "0001_initial_schema",
    sql: readFileSync(new URL("./schema.sql", import.meta.url), "utf8"),
  },
];

export function runMigrations(path?: string) {
  const db = openDb(path);
  db.exec(`
    create table if not exists _migrations (
      id text primary key,
      executed_at text not null
    );
  `);

  for (const migration of migrations) {
    const existing = db.query("select id from _migrations where id = ?").get(migration.id) as
      | { id: string }
      | null;

    if (existing) {
      continue;
    }

    db.exec(migration.sql);
    db.query("insert into _migrations (id, executed_at) values (?, ?)").run(
      migration.id,
      new Date().toISOString(),
    );
  }
}

if (import.meta.main) {
  runMigrations(process.argv[2]);
  console.log("migrations complete");
}
