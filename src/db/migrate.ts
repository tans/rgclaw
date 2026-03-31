import { readFileSync } from "node:fs";
import { openDb } from "./sqlite";

type Migration = {
  id: string;
  sql: string;
};

type RunMigrationsOptions = {
  migrations?: Migration[];
  beforeRecordMigration?: (migrationId: string) => void;
};

const defaultMigrations: Migration[] = [
  {
    id: "0001_initial_schema",
    sql: readFileSync(new URL("./schema.sql", import.meta.url), "utf8"),
  },
];

export function runMigrations(path?: string, options: RunMigrationsOptions = {}) {
  const db = openDb(path);
  const migrations = options.migrations ?? defaultMigrations;

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

    db.transaction((entry: Migration) => {
      db.exec(entry.sql);
      options.beforeRecordMigration?.(entry.id);
      db.query("insert into _migrations (id, executed_at) values (?, ?)").run(
        entry.id,
        new Date().toISOString(),
      );
    })(migration);
  }
}

if (import.meta.main) {
  runMigrations(process.argv[2]);
  console.log("migrations complete");
}
