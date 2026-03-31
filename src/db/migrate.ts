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
  {
    id: "0002_wechat_multi_bot",
    sql: readFileSync(new URL("./migrations/0002_wechat_multi_bot.sql", import.meta.url), "utf8"),
  },
];

function hasWechatMultiBotSchema(db: ReturnType<typeof openDb>): boolean {
  const inboundEventsTable = db
    .query("select name from sqlite_master where type = 'table' and name = 'wechat_inbound_events'")
    .get() as { name: string } | null;
  const userWechatBindingsColumns = db
    .query("pragma table_info(user_wechat_bindings)")
    .all() as Array<{ name: string }>;
  const activeUserIndex = db
    .query(
      "select name from sqlite_master where type = 'index' and name = 'idx_user_wechat_bindings_active_user'",
    )
    .get() as { name: string } | null;

  const columnNames = new Set(userWechatBindingsColumns.map((column) => column.name));

  return (
    inboundEventsTable?.name === "wechat_inbound_events" &&
    activeUserIndex?.name === "idx_user_wechat_bindings_active_user" &&
    columnNames.has("bot_id") &&
    columnNames.has("last_keepalive_sent_at")
  );
}

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
      const shouldSkipSqlExecution =
        entry.id === "0002_wechat_multi_bot" && hasWechatMultiBotSchema(db);
      if (!shouldSkipSqlExecution) {
        db.exec(entry.sql);
      }
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
