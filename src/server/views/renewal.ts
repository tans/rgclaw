import { config } from "../../shared/config";

export function renderRenewalPage(walletAddress: string) {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"/><title>续费</title></head><body><main><h1>续费</h1><div>当前价格: 0.005 BNB / 30 天</div><div>收款地址: ${config.bnbCollectionWallet}</div><div>登记钱包: ${walletAddress || "未填写"}</div><div>请从登记钱包转账，到账后自动续期。</div></main></body></html>`;
}
