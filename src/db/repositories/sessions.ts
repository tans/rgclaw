import type { Database } from "bun:sqlite";
import { openDb } from "../sqlite";

export type SessionRecord = {
  id: string;
  user_id: string;
  expires_at: string;
  created_at: string;
};

function databasePath() {
  return process.env.DATABASE_PATH ?? "./data/app.sqlite";
}

const THIRTY_DAYS_IN_MS = 30 * 24 * 60 * 60 * 1000;

function insertSession(db: Database, userId: string) {
  const id = crypto.randomUUID();
  const createdAt = new Date().toISOString();
  const expiresAt = new Date(Date.now() + THIRTY_DAYS_IN_MS).toISOString();

  db.query("insert into sessions (id, user_id, expires_at, created_at) values (?, ?, ?, ?)").run(
    id,
    userId,
    expiresAt,
    createdAt,
  );

  return {
    id,
    user_id: userId,
    expires_at: expiresAt,
    created_at: createdAt,
  } satisfies SessionRecord;
}

export function createSession(userId: string, db?: Database) {
  if (db) {
    return insertSession(db, userId);
  }

  const ownedDb = openDb(databasePath());

  try {
    return insertSession(ownedDb, userId);
  } finally {
    ownedDb.close();
  }
}

export function findSession(sessionId: string) {
  const db = openDb(databasePath());

  try {
    const session = db
      .query("select id, user_id, expires_at, created_at from sessions where id = ? and expires_at > ?")
      .get(sessionId, new Date().toISOString()) as SessionRecord | null;

    return session;
  } finally {
    db.close();
  }
}
