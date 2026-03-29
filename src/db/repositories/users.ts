import type { Database } from "bun:sqlite";
import { openDb } from "../sqlite";

export type UserRecord = {
  id: string;
  email: string;
  password_hash: string;
  created_at: string;
  updated_at: string;
};

function databasePath() {
  return process.env.DATABASE_PATH ?? "./data/app.sqlite";
}

export function createUserWithPasswordHash(db: Database, email: string, passwordHash: string) {
  const now = new Date().toISOString();
  const id = crypto.randomUUID();

  db.query(
    "insert into users (id, email, password_hash, created_at, updated_at) values (?, ?, ?, ?, ?)",
  ).run(id, email, passwordHash, now, now);

  return {
    id,
    email,
    password_hash: passwordHash,
    created_at: now,
    updated_at: now,
  } satisfies UserRecord;
}

export async function createUser(email: string, password: string) {
  const db = openDb(databasePath());

  try {
    const passwordHash = await Bun.password.hash(password);
    return createUserWithPasswordHash(db, email, passwordHash);
  } finally {
    db.close();
  }
}

export function findUserByEmail(email: string) {
  const db = openDb(databasePath());

  try {
    const user = db
      .query(
        "select id, email, password_hash, created_at, updated_at from users where email = ?",
      )
      .get(email) as UserRecord | null;

    return user;
  } finally {
    db.close();
  }
}
