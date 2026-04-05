import { openDb } from "../sqlite";

type SubscriptionSource = "flap" | "four";

export type SubscriptionRecord = {
  source: SubscriptionSource;
  enabled: number;
};

const DEFAULT_SOURCES: SubscriptionSource[] = ["flap", "four"];

export function ensureDefaultSubscriptions(userId: string) {
  const db = openDb();

  try {
    const now = new Date().toISOString();

    for (const source of DEFAULT_SOURCES) {
      db.query(
        "insert or ignore into user_source_subscriptions (id, user_id, source, enabled, created_at, updated_at) values (?, ?, ?, ?, ?, ?)",
      ).run(crypto.randomUUID(), userId, source, 1, now, now);
    }
  } finally {
    db.close();
  }
}

export function listSubscriptions(userId: string): SubscriptionRecord[] {
  const db = openDb();

  try {
    return db
      .query("select source, enabled from user_source_subscriptions where user_id = ? order by source asc")
      .all(userId) as SubscriptionRecord[];
  } finally {
    db.close();
  }
}

export function upsertWalletAddress(userId: string, walletAddress: string) {
  const db = openDb();

  try {
    const now = new Date().toISOString();
    db.query(
      "update users set wallet_address = ?, wallet_address_updated_at = ?, updated_at = ? where id = ?",
    ).run(walletAddress, now, now, userId);
  } finally {
    db.close();
  }
}

export function toggleSubscription(userId: string, source: string): boolean {
  const db = openDb();
  try {
    const result = db
      .query(
        `UPDATE user_source_subscriptions 
         SET enabled = CASE WHEN enabled = 1 THEN 0 ELSE 1 END,
             updated_at = ?
         WHERE user_id = ? AND source = ?`
      )
      .run(new Date().toISOString(), userId, source);
    return result.changes > 0;
  } finally {
    db.close();
  }
}
