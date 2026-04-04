import { config } from "../shared/config";
import { applyIncomingTransfer } from "./payment-watcher";

type BscTxReceipt = {
  transactionHash: string;
  from: string;
  to: string;
  value: string; // in hex wei
  blockNumber: string;
};

function weiToDecimal(hexWei: string): string {
  return (BigInt(hexWei) / BigInt(1)).toString();
}

export async function handleBscTransferWebhook(txHash: string): Promise<{
  ok: boolean;
  creditedDays?: number;
  newExpiresAt?: string;
  error?: string;
}> {
  // Fetch transaction receipt from BSC
  const rpcUrl = config.bscRpcUrl;
  let receipt: BscTxReceipt;

  try {
    const rpcResp = await fetch(rpcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        method: "eth_getTransactionReceipt",
        params: [txHash],
        id: 1,
      }),
    });

    const rpcData = (await rpcResp.json()) as {
      result?: BscTxReceipt;
      error?: { message: string };
    };

    if (rpcData.error || !rpcData.result) {
      return { ok: false, error: rpcData.error?.message ?? "tx not found" };
    }

    receipt = rpcData.result;
  } catch (err) {
    return { ok: false, error: `rpc error: ${err instanceof Error ? err.message : String(err)}` };
  }

  // Validate it's a transfer to our collection wallet
  const collectionWallet = config.bnbCollectionWallet.toLowerCase();
  if (!receipt.to || receipt.to.toLowerCase() !== collectionWallet) {
    return { ok: false, error: "not a transfer to collection wallet" };
  }

  // Verify value is at least one unit
  const minUnitWei = BigInt(config.priceUnitWei);
  const txValueWei = BigInt(receipt.value);

  if (txValueWei < minUnitWei) {
    return { ok: false, error: "value below minimum payment unit" };
  }

  // Get block timestamp
  let paidAt: string;
  try {
    const blockResp = await fetch(rpcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        method: "eth_getBlockByNumber",
        params: [receipt.blockNumber, false],
        id: 1,
      }),
    });

    const blockData = (await blockResp.json()) as {
      result?: { timestamp: string };
      error?: { message: string };
    };

    const timestampHex = blockData.result?.timestamp ?? "0x0";
    const timestampSec = Number(timestampHex) * 1000;
    paidAt = new Date(timestampSec).toISOString();
  } catch {
    paidAt = new Date().toISOString();
  }

  // Apply the transfer
  try {
    const result = await applyIncomingTransfer({
      txHash: receipt.transactionHash,
      from: receipt.from,
      to: receipt.to,
      valueWei: receipt.value,
      paidAt,
    });

    return {
      ok: true,
      creditedDays: result.creditedDays,
      newExpiresAt: result.newExpiresAt,
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
