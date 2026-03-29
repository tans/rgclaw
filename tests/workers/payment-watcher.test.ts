import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { runMigrations } from "../../src/db/migrate";
import { openDb } from "../../src/db/sqlite";
import { applyIncomingTransfer } from "../../src/workers/payment-watcher";

function setupPaymentWatcherTestDb() {
  const dir = mkdtempSync(join(tmpdir(), "rgclaw-payment-watcher-"));
  const dbPath = join(dir, "app.sqlite");
  process.env.DATABASE_PATH = dbPath;
  runMigrations(dbPath);

  return {
    dbPath,
    cleanup() {
      rmSync(dir, { recursive: true, force: true });
      delete process.env.DATABASE_PATH;
    },
  };
}

describe("payment watcher", () => {
  test("0.01 BNB 自动续期 60 天", async () => {
    const { dbPath, cleanup } = setupPaymentWatcherTestDb();
    const db = openDb(dbPath);

    try {
      db.exec(`
        insert into users (id, email, password_hash, wallet_address, created_at, updated_at)
        values ('u1', 'pay@example.com', 'x', '0xuserwallet', '2026-03-29T00:00:00.000Z', '2026-03-29T00:00:00.000Z');
        insert into user_entitlements (id, user_id, plan_type, status, starts_at, expires_at, source, created_at, updated_at)
        values ('e1', 'u1', 'paid', 'active', '2026-03-29T00:00:00.000Z', '2026-04-01T00:00:00.000Z', 'bnb_payment', '2026-03-29T00:00:00.000Z', '2026-03-29T00:00:00.000Z');
      `);

      const result = await applyIncomingTransfer({
        txHash: "0xtx-1",
        from: "0xuserwallet",
        to: "0xaCEa067c6751083e4e652543A436638c1e777777",
        valueWei: "10000000000000000",
        paidAt: "2026-03-30T00:00:00.000Z",
      });

      const record = db
        .query("select credited_days, status from payment_records where tx_hash = ?")
        .get("0xtx-1") as { credited_days: number; status: string } | null;
      const entitlement = db
        .query("select expires_at from user_entitlements where id = 'e1'")
        .get() as { expires_at: string } | null;

      expect(result.creditedDays).toBe(60);
      expect(result.userId).toBe("u1");
      expect(record?.credited_days).toBe(60);
      expect(record?.status).toBe("applied");
      expect(entitlement?.expires_at).toBe("2026-05-31T00:00:00.000Z");
    } finally {
      db.close();
      cleanup();
    }
  });
});
