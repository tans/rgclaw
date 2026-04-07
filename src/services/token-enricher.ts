/**
 * Token Enricher — 从 BSC 链上读取代币信息，不依赖任何第三方 API
 *
 * 读取内容：
 *  - 代币基础信息：symbol / name / decimals / totalSupply
 *  - PancakeSwap V2 Pair 地址（BNB / USDT 交易对）
 */

import { createBscRpcClient } from "../collectors/rpc";

export interface EnrichedToken {
  tokenAddress: string;
  symbol: string | null;
  name: string | null;
  decimals: number | null;
  totalSupply: string | null;
  pairAddress: string | null;   // PancakeSwap V2 Pair（BNB 或 USDT）
  isBEP20Valid: boolean;
}

// PancakeSwap V2
const PCS_FACTORY = "0xcA143Ce32Fe78f1f7019d7d551a6402fC5350c73";
const WBNB        = "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c";
const USDT        = "0x55d398326f99059fF775485246999027B3197955";

// 已知 Function Selector（前 4 字节，keccak256 结果）
const SELECTORS = {
  symbol:       "95d89b41",  // symbol()
  name:         "06fdde03",  // name()
  decimals:     "313ce567",  // decimals()
  totalSupply:  "18160ddd",  // totalSupply()
  getPair:      "f305d719",  // getPair(address,address)
};

// BSC 链上 eth_call 超时（毫秒）
const CALL_TIMEOUT_MS = 3000;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error("timeout")), ms)),
  ]);
}

/** 读 ERC-20 / BEP-20 string 属性（symbol / name） */
async function readString(client: ReturnType<typeof createBscRpcClient>, token: string, selector: string): Promise<string | null> {
  try {
    const result: string = await withTimeout(
      client.rawCall("eth_call", [{ to: token, data: "0x" + selector }, "latest"]),
      CALL_TIMEOUT_MS,
    );
    if (!result || result === "0x" || result === "0x0000000000000000000000000000000000000000000000000000000000000020") return null;
    // ERC-20 string encoding: 前 64 字节 = offset(32) + length(32)
    const hex = result.slice(2);
    const strLen = parseInt(hex.slice(64, 128), 16);
    if (strLen === 0 || strLen > 256) return null;
    const strHex = hex.slice(128, 128 + strLen * 2);
    const str = Buffer.from(strHex, "hex").toString("utf8").replace(/\x00+/g, "").trim();
    return str || null;
  } catch {
    return null;
  }
}

/** 读 decimals（uint8） */
async function readDecimals(client: ReturnType<typeof createBscRpcClient>, token: string): Promise<number | null> {
  try {
    const result: string = await withTimeout(
      client.rawCall("eth_call", [{ to: token, data: "0x" + SELECTORS.decimals }, "latest"]),
      CALL_TIMEOUT_MS,
    );
    if (!result) return null;
    return parseInt(result.slice(-2), 16);
  } catch {
    return null;
  }
}

/** 读 totalSupply（uint256） */
async function readTotalSupply(client: ReturnType<typeof createBscRpcClient>, token: string): Promise<string | null> {
  try {
    const result: string = await withTimeout(
      client.rawCall("eth_call", [{ to: token, data: "0x" + SELECTORS.totalSupply }, "latest"]),
      CALL_TIMEOUT_MS,
    );
    if (!result || result === "0x") return null;
    return result;
  } catch {
    return null;
  }
}

/** 查询 PCS Factory.getPair(tokenA, tokenB) */
async function getPair(client: ReturnType<typeof createBscRpcClient>, tokenA: string, tokenB: string): Promise<string | null> {
  try {
    const addrA = tokenA.toLowerCase().replace("0x", "").padStart(64, "0");
    const addrB = tokenB.toLowerCase().replace("0x", "").padStart(64, "0");
    const data = "0x" + SELECTORS.getPair + addrA + addrB;
    const result: string = await withTimeout(
      client.rawCall("eth_call", [{ to: PCS_FACTORY, data }, "latest"]),
      CALL_TIMEOUT_MS,
    );
    if (!result || result === "0x" || result === "0x0000000000000000000000000000000000000000000000000000000000000000") {
      return null;
    }
    return "0x" + result.slice(-40);
  } catch {
    return null;
  }
}

/** 主函数：丰富单个代币 */
export async function enrichToken(tokenAddress: string): Promise<EnrichedToken> {
  if (!/^0x[a-fA-F0-9]{40}$/.test(tokenAddress)) {
    return { tokenAddress, symbol: null, name: null, decimals: null, totalSupply: null, pairAddress: null, isBEP20Valid: false };
  }

  const client = createBscRpcClient();
  const [symbol, name, decimals, totalSupply, pairBNB, pairUSDT] = await Promise.all([
    readString(client, tokenAddress, SELECTORS.symbol),
    readString(client, tokenAddress, SELECTORS.name),
    readDecimals(client, tokenAddress),
    readTotalSupply(client, tokenAddress),
    getPair(client, tokenAddress, WBNB),
    getPair(client, tokenAddress, USDT),
  ]);

  const isBEP20Valid = !!(symbol || name);
  const pairAddress = pairBNB ?? pairUSDT ?? null;

  return { tokenAddress, symbol: symbol ?? null, name: name ?? null, decimals, totalSupply, pairAddress, isBEP20Valid };
}

/** 格式化发行量（人性化展示） */
export function formatTotalSupply(raw: string | null, decimals: number | null): string {
  if (!raw || !decimals) return "未知";
  try {
    const val = BigInt(raw);
    const div = 10n ** BigInt(decimals);
    const integer = val / div;
    const rem    = val % div;
    const frac   = rem.toString().padStart(decimals, "0").slice(0, 4).replace(/0+$/, "");
    return `${integer.toLocaleString("en-US")}${frac ? "." + frac : ""}`;
  } catch {
    return "未知";
  }
}

/** 完整发射消息（增强版） */
export function buildEnrichedMessage(
  tokenAddress: string,
  source: string,
  symbol: string | null,
  _title: string | null,
  enriched: EnrichedToken,
): string {
  const lines: string[] = [];

  lines.push(enriched.symbol ? `🔥 ${enriched.symbol} 发射啦！` : `🔥 新币发射！`);

  const srcLabel = source === "flap" ? "Flap" : source === "four" ? "4-byte" : source;
  lines.push(`📡 来源：${srcLabel}`);

  if (enriched.name) lines.push(`🔤 全称：${enriched.name}`);

  const supply = formatTotalSupply(enriched.totalSupply, enriched.decimals);
  if (supply !== "未知") lines.push(`💰 发行量：${supply}`);

  lines.push(`\n📍 合约：${tokenAddress}`);

  if (enriched.pairAddress) {
    lines.push(`\n🥞 交易对：${enriched.pairAddress}`);
    lines.push(`🔗 https://pancakeswap.finance/swap?outputCurrency=${tokenAddress}`);
  } else {
    lines.push(`\n🥞 暂未找到 PCS 交易对`);
  }

  lines.push(`\n🔍 BSCScan：https://bscscan.com/token/${tokenAddress}`);

  if (!enriched.isBEP20Valid) {
    lines.push(`\n⚠️ 无法读合约信息，请自行核实安全性`);
  }

  return lines.join("\n");
}
