import { openDb } from "../sqlite";

export function insertPaymentRecord(input: {
  userId: string;
  fromWalletAddress: string;
  toWalletAddress: string;
  txHash: string;
  amountBnbWei: string;
  creditedDays: number;
  status: string;
  paidAt: string;
  rawPayload: string;
}) {
  const db = openDb();

  try {
    db.query(
      "insert into payment_records (id, user_id, from_wallet_address, to_wallet_address, tx_hash, amount_bnb_wei, credited_days, status, paid_at, raw_payload, created_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    ).run(
      crypto.randomUUID(),
      input.userId,
      input.fromWalletAddress,
      input.toWalletAddress,
      input.txHash,
      input.amountBnbWei,
      input.creditedDays,
      input.status,
      input.paidAt,
      input.rawPayload,
      new Date().toISOString(),
    );
  } finally {
    db.close();
  }
}
