import type { Database } from "bun:sqlite";
import { openDb } from "../sqlite";
import { ensureTrialEntitlement } from "./entitlements";

export type UserRecord = {
  id: string;
  email: string | null;
  password_hash: string | null;
  hub_user_id: string | null;
  wallet_address: string | null;
  created_at: string;
  updated_at: string;
};

function databasePath() {
  return process.env.DATABASE_PATH ?? "./data/app.sqlite";
}

export function createUserWithPasswordHash(
  db: Database,
  email: string,
  passwordHash: string,
  hubUserId?: string
) {
  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  db.query(
    "insert into users (id, email, password_hash, hub_user_id, created_at, updated_at) values (?, ?, ?, ?, ?, ?)",
  ).run(id, email, passwordHash, hubUserId ?? null, now, now);
  return {
    id,
    email,
    password_hash: passwordHash,
    hub_user_id: hubUserId ?? null,
    created_at: now,
    updated_at: now,
  } satisfies UserRecord;
}

export async function createUser(
  email: string,
  password: string,
  hubUserId?: string
) {
  const db = openDb(databasePath());
  try {
    const passwordHash = await Bun.password.hash(password);
    return createUserWithPasswordHash(db, email, passwordHash, hubUserId);
  } finally {
    db.close();
  }
}

// 通过钱包地址查找或创建用户
export function upsertUserByWalletAddress(walletAddress: string): string {
  const db = openDb(databasePath());
  try {
    const normalizedWallet = walletAddress.toLowerCase().trim();
    
    // 查找现有用户
    const existing = db
      .query("select id from users where wallet_address = ?")
      .get(normalizedWallet) as { id: string } | null;
    
    if (existing) {
      const now = new Date().toISOString();
      db.query("update users set wallet_address_updated_at = ?, updated_at = ? where id = ?")
        .run(now, now, existing.id);
      return existing.id;
    }
    
    // 创建新用户（无邮箱）
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    
    db.query(
      "insert into users (id, email, password_hash, wallet_address, wallet_address_updated_at, hub_user_id, created_at, updated_at) values (?, null, null, ?, ?, null, ?, ?)",
    ).run(id, normalizedWallet, now, now, now);
    
    return id;
  } finally {
    db.close();
  }
}

export function findUserByEmail(email: string) {
  const db = openDb(databasePath());
  try {
    const user = db
      .query(
        "select id, email, password_hash, hub_user_id, wallet_address, created_at, updated_at from users where email = ?",
      )
      .get(email) as UserRecord | null;
    return user;
  } finally {
    db.close();
  }
}

export function findUserByWallet(walletAddress: string) {
  const db = openDb(databasePath());
  try {
    const user = db
      .query("select id, email, password_hash, hub_user_id, wallet_address, created_at, updated_at from users where wallet_address = ?")
      .get(walletAddress.toLowerCase()) as UserRecord | null;
    return user;
  } finally {
    db.close();
  }
}

export function findUserByHubUserId(hubUserId: string) {
  const db = openDb(databasePath());
  try {
    const user = db
      .query("select id, email, password_hash, hub_user_id, wallet_address, created_at, updated_at from users where hub_user_id = ?")
      .get(hubUserId) as UserRecord | null;
    return user;
  } finally {
    db.close();
  }
}

export function upsertUserByHubUserId(hubUserId: string, email: string) {
  const db = openDb(databasePath());
  try {
    const existing = db.query("select id from users where hub_user_id = ?").get(hubUserId) as { id: string } | null;
    if (existing) {
      const now = new Date().toISOString();
      db.query("update users set email = ?, updated_at = ? where hub_user_id = ?").run(email, now, hubUserId);
      return existing.id;
    }
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    db.query(
      "insert into users (id, email, password_hash, hub_user_id, wallet_address, wallet_address_updated_at, created_at, updated_at) values (?, ?, '', ?, null, null, ?, ?)",
    ).run(id, email, hubUserId, now, now);
    ensureTrialEntitlement(id);
    return id;
  } finally {
    db.close();
  }
}
