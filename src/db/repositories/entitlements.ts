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
