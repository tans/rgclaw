import { config } from "../shared/config";
import { insertPaymentRecord } from "../db/repositories/payment-records";
import { openDb } from "../db/sqlite";

const PRICE_UNIT_WEI = BigInt(config.priceUnitWei);
const CREDIT_DAYS_PER_UNIT = 30;

// Fixed plan prices in wei
const PLAN_PRICES: { price: bigint; days: number }[] = [
  { price: BigInt("20000000000000000"), days: 30 }, // 0.02 BNB = 30 days (monthly)
  { price: BigInt("50000000000000000"), days: 90 }, // 0.05 BNB = 90 days (quarterly)
  { price: BigInt("100000000000000000"), days: 365 }, // 0.1 BNB = 365 days (yearly)
];

type IncomingTransfer = {
  txHash: string;
  from: string;
  to: string;
  valueWei: string;
  paidAt: string;
};

function calculateCreditedDays(valueWei: bigint): number {
  // First check if exact match to a fixed plan
  for (const plan of PLAN_PRICES) {
    if (valueWei === plan.price) {
      return plan.days;
    }
  }
  // Fallback to unit-based calculation
  const units = Number(valueWei / PRICE_UNIT_WEI);
  return units * CREDIT_DAYS_PER_UNIT;
}

export async function applyIncomingTransfer(input: IncomingTransfer) {
  if (input.to.toLowerCase() !== config.bnbCollectionWallet.toLowerCase()) {
    throw new Error("invalid collection wallet");
  }

  const db = openDb();

  try {
    const user = db
      .query("select id from users where lower(wallet_address) = lower(?)")
      .get(input.from) as { id: string } | null;

    if (!user) {
      throw new Error("wallet not matched");
    }

    const valueWei = BigInt(input.valueWei);
    const creditedDays = calculateCreditedDays(valueWei);

    const entitlement = db
      .query("select id, expires_at from user_entitlements where user_id = ? order by expires_at desc limit 1")
      .get(user.id) as { id: string; expires_at: string } | null;

    const paidAtMs = new Date(input.paidAt).getTime();
    const entitlementExpiresAtMs = entitlement ? new Date(entitlement.expires_at).getTime() : 0;
    const baseTimeMs = entitlementExpiresAtMs > paidAtMs ? entitlementExpiresAtMs : paidAtMs;
    const newExpiresAt = new Date(
      baseTimeMs + creditedDays * 24 * 60 * 60 * 1000,
    ).toISOString();

    if (entitlement) {
      db.query("update user_entitlements set expires_at = ?, updated_at = ? where id = ?").run(
        newExpiresAt,
        new Date().toISOString(),
        entitlement.id,
      );
    }

    insertPaymentRecord({
      userId: user.id,
      fromWalletAddress: input.from,
      toWalletAddress: input.to,
      txHash: input.txHash,
      amountBnbWei: input.valueWei,
      creditedDays,
      status: "applied",
      paidAt: input.paidAt,
      rawPayload: JSON.stringify(input),
    });

    return {
      userId: user.id,
      creditedDays,
      newExpiresAt,
    };
  } finally {
    db.close();
  }
}
