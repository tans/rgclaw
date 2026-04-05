import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { openDb } from "./sqlite";

type Migration = {
  id: string;
  sql: string;
};

type RunMigrationsOptions = {
  migrations?: Migration[];
  beforeRecordMigration?: (migrationId: string) => void;
};

function loadSqlMigrations(): Migration[] {
  const migrationsDir = new URL("./migrations", import.meta.url);
  const files = readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  return files.map((file) => ({
    id: file.replace(".sql", ""),
    sql: readFileSync(join(migrationsDir.pathname, file), "utf8"),
  }));
}

const defaultMigrations: Migration[] = loadSqlMigrations();

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
