import { config } from "../shared/config";
import { handleBscTransferWebhook } from "./payment-webhook";
import { openDb } from "../db/sqlite";

const BSC_SCAN_BASE = "https://api.bscscan.io/api";
const BSC_SCAN_API_KEY = process.env.BSCSAN_API_KEY ?? ""; // Optional, works without key but rate-limited
const SCAN_PAGE_SIZE = 100;

function getLastScannedBlock(): number {
  const db = openDb();
  try {
    const row = db
      .query("select meta_value from _meta where meta_key = 'payment_scan_block'")
      .get() as { meta_value: string } | null;
    return row ? parseInt(row.meta_value, 10) : 0;
  } finally {
    db.close();
  }
}

function setLastScannedBlock(block: number) {
  const db = openDb();
  try {
    db.query(
      "insert or replace into _meta (meta_key, meta_value) values ('payment_scan_block', ?)",
    ).run(String(block));
  } finally {
    db.close();
  }
}

function ensureMetaTable() {
  const db = openDb();
  try {
    db.query(
      "create table if not exists _meta (meta_key text primary key, meta_value text not null)",
    ).run();
  } finally {
    db.close();
  }
}

type BscscanTx = {
  hash: string;
  from: string;
  to: string;
  value: string; // in wei as decimal string
  timeStamp: string;
  blockNumber: string;
  isError: string;
};

type BscscanResponse = {
  status: string;
  message: string;
  result: BscscanTx[] | string;
};

async function fetchBscscanTxs(address: string, startBlock: number): Promise<BscscanTx[]> {
  const params = new URLSearchParams({
    module: "account",
    action: "txlist",
    address,
    startblock: String(startBlock),
    endblock: "99999999",
    page: "1",
    offset: String(SCAN_PAGE_SIZE),
    sort: "asc",
  });

  if (BSC_SCAN_API_KEY) {
    params.set("apikey", BSC_SCAN_API_KEY);
  }

  const url = `${BSC_SCAN_BASE}?${params.toString()}`;
  const resp = await fetch(url);

  if (!resp.ok) {
    throw new Error(`bscscan api error: ${resp.status}`);
  }

  const data = (await resp.json()) as BscscanResponse;

  if (data.status !== "1" || !Array.isArray(data.result)) {
    // No more results or error
    return [];
  }

  return data.result;
}

export async function scanRecentPaymentTransfers(): Promise<number> {
  ensureMetaTable();

  const collectionWallet = config.bnbCollectionWallet;
  const lastScanned = getLastScannedBlock();
  const startBlock = Math.max(lastScanned, 1);

  let txs: BscscanTx[];

  try {
    txs = await fetchBscscanTxs(collectionWallet, startBlock);
  } catch (err) {
    console.warn("[payment-scanner] bscscan fetch failed:", err);
    return 0;
  }

  if (txs.length === 0) {
    return 0;
  }

  // Filter for successful transfers above minimum unit
  const minWei = BigInt(config.priceUnitWei);
  let processed = 0;
  let highestBlock = lastScanned;

  for (const tx of txs) {
    const blockNum = parseInt(tx.blockNumber, 10);
    if (blockNum <= lastScanned) continue;
    if (tx.isError === "1") continue;

    const valueWei = BigInt(tx.value);
    if (valueWei < minWei) continue;

    highestBlock = Math.max(highestBlock, blockNum);

    const result = await handleBscTransferWebhook(tx.hash);
    if (result.ok) {
      processed++;
    }
  }

  if (highestBlock > lastScanned) {
    setLastScannedBlock(highestBlock);
  }

  return processed;
}
