import { openDb } from "../sqlite";

export type ActiveEntitlementRecord = {
  plan_type: string;
  status: string;
  starts_at: string;
  expires_at: string;
};

export function getActiveEntitlement(userId: string) {
  const db = openDb();

  try {
    return db
      .query(
        "select plan_type, status, starts_at, expires_at from user_entitlements where user_id = ? and status = 'active' order by expires_at desc limit 1",
      )
      .get(userId) as ActiveEntitlementRecord | null;
  } finally {
    db.close();
  }
}

export function ensureTrialEntitlement(userId: string) {
  const db = openDb();

  try {
    const existing = db
      .query("select id from user_entitlements where user_id = ? and plan_type = 'trial' limit 1")
      .get(userId) as { id: string } | null;

    if (existing) {
      return;
    }

    const now = new Date();
    const startsAt = now.toISOString();
    const expiresAt = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000).toISOString();

    db.query(
      "insert into user_entitlements (id, user_id, plan_type, status, starts_at, expires_at, source, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    ).run(
      crypto.randomUUID(),
      userId,
      "trial",
      "active",
      startsAt,
      expiresAt,
      "trial_signup",
      startsAt,
      startsAt,
    );
  } finally {
    db.close();
  }
}

export function markReminderSent(entitlementId: string) {
  const db = openDb();

  try {
    const now = new Date().toISOString();
    db.query("update user_entitlements set renewal_reminded_at = ?, updated_at = ? where id = ?").run(
      now,
      now,
      entitlementId,
    );
  } finally {
    db.close();
  }
}
