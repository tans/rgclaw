import { config } from "../../shared/config";

export function renderRenewalPage(props: {
  walletAddress: string;
  entitlementExpiresAt: string | null;
  planType: string | null;
}) {
  const { walletAddress, entitlementExpiresAt, planType } = props;

  return `<!DOCTYPE html>
<html lang="zh">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>续费推送服务</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #f5f5f5; color: #333; }
  .container { max-width: 540px; margin: 40px auto; padding: 0 20px; }
  .card { background: #fff; border-radius: 12px; padding: 24px; box-shadow: 0 2px 12px rgba(0,0,0,0.06); margin-bottom: 16px; }
  h1 { font-size: 20px; font-weight: 700; margin-bottom: 4px; }
  .subtitle { font-size: 14px; color: #888; margin-bottom: 24px; }
  .info-box { background: #f8f9fa; border-radius: 8px; padding: 16px; margin-bottom: 16px; }
  .info-row { display: flex; justify-content: space-between; font-size: 14px; padding: 6px 0; }
  .info-row:not(:last-child) { border-bottom: 1px solid #eee; }
  .info-label { color: #888; }
  .info-value { font-weight: 600; }
  .wallet-box { background: #fff8e6; border: 1px solid #ffe082; border-radius: 8px; padding: 16px; margin-bottom: 16px; }
  .wallet-box .label { font-size: 12px; color: #92600a; margin-bottom: 6px; font-weight: 600; }
  .wallet-box .address { font-size: 13px; font-family: monospace; color: #333; word-break: break-all; }
  .wallet-box .address-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
  .wallet-box .address-row .address { flex: 1; min-width: 200px; }
  .copy-btn { background: #e8f5e9; border: 1px solid #c8e6c9; border-radius: 6px; padding: 6px 10px; cursor: pointer; font-size: 14px; transition: background 0.2s; }
  .copy-btn:hover { background: #c8e6c9; }
  .copy-btn.copied { background: #4caf50; color: #fff; border-color: #4caf50; }
  .explorer-link { background: #e3f2fd; border: 1px solid #bbdefb; border-radius: 6px; padding: 6px 10px; font-size: 14px; text-decoration: none; transition: background 0.2s; }
  .explorer-link:hover { background: #bbdefb; }
  .wallet-form { margin-bottom: 8px; }
  input[type="text"] { width: 100%; padding: 10px 12px; border: 1px solid #ddd; border-radius: 8px; font-size: 14px; font-family: monospace; box-sizing: border-box; }
  input[type="text"]:focus { outline: none; border-color: #0070f0; }
  .btn { background: #0070f0; color: #fff; border: none; border-radius: 8px; padding: 12px 24px; font-size: 14px; font-weight: 600; cursor: pointer; width: 100%; }
  .btn:hover { background: #0062cc; }
  .btn-secondary { background: #f0f0f0; color: #333; margin-top: 8px; }
  .plans { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin: 16px 0; }
  .plan { border: 1px solid #eee; border-radius: 10px; padding: 16px; text-align: center; }
  .plan.popular { border-color: rgb(7, 193, 96); background: rgba(7, 193, 96, 0.04); }
  .plan-name { font-size: 12px; color: #888; margin-bottom: 6px; }
  .plan-price { font-size: 20px; font-weight: 700; }
  .plan-price span { font-size: 13px; font-weight: 400; color: #888; }
  .plan-unit { font-size: 11px; color: #aaa; margin-top: 4px; }
  .steps { margin: 16px 0; }
  .step { display: flex; gap: 12px; margin-bottom: 12px; align-items: flex-start; }
  .step-num { width: 24px; height: 24px; border-radius: 50%; background: #e8e8e8; color: #666; font-size: 12px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
  .step-text { font-size: 13px; color: #555; padding-top: 2px; line-height: 1.5; }
  .note { font-size: 12px; color: #888; margin-top: 16px; padding: 10px; background: #f9f9f9; border-radius: 6px; }
  .back { display: block; text-align: center; margin-top: 16px; color: #0070f0; text-decoration: none; font-size: 14px; }
</style>
</head>
<body>
<div class="container">
  <div class="card">
    <h1>💳 续费推送服务</h1>
    <p class="subtitle">BNB 链上付款，自动即时生效</p>

    ${entitlementExpiresAt ? `
    <div class="info-box">
      <div class="info-row">
        <span class="info-label">当前状态</span>
        <span class="info-value">${planType === "trial" ? "试用中" : "已订阅"}</span>
      </div>
      <div class="info-row">
        <span class="info-label">到期时间</span>
        <span class="info-value">${entitlementExpiresAt}</span>
      </div>
    </div>
    ` : ""}

    <div class="plans">
      <div class="plan">
        <div class="plan-name">月付</div>
        <div class="plan-price">0.02 <span>BNB</span></div>
        <div class="plan-unit">= 30 天</div>
      </div>
      <div class="plan">
        <div class="plan-name">季付</div>
        <div class="plan-price">0.05 <span>BNB</span></div>
        <div class="plan-unit">= 90 天</div>
      </div>
      <div class="plan popular">
        <div class="plan-name">年付 · 推荐</div>
        <div class="plan-price">0.1 <span>BNB</span></div>
        <div class="plan-unit">= 365 天</div>
      </div>
    </div>

    <div class="wallet-box">
      <div class="label">📦 付款地址（向此地址转账）</div>
      <div class="address-row">
        <span class="address" id="payAddr">${config.bnbCollectionWallet}</span>
        <button id="copyBtn" class="copy-btn" title="复制地址">📋</button>
      </div>
    </div>

    <div class="steps">
      <div class="step">
        <div class="step-num">1</div>
        <div class="step-text">确保你的钱包地址已登记（见下方）</div>
      </div>
      <div class="step">
        <div class="step-num">2</div>
        <div class="step-text">从登记钱包向以上地址转账 0.02 BNB（月付）、0.05 BNB（季付）或 0.1 BNB（年付）</div>
      </div>
      <div class="step">
        <div class="step-num">3</div>
        <div class="step-text">系统自动检测链上转账，即时续期，无需人工处理</div>
      </div>
    </div>

    <div class="note">💡 付款钱包必须与登记钱包一致才能自动续期。</div>
  </div>
</div>

<a href="/me" class="back">← 返回用户中心</a>
</body>
<script>
document.getElementById('copyBtn')?.addEventListener('click', async () => {
  const addr = document.getElementById('payAddr')?.textContent || '';
  const btn = document.getElementById('copyBtn');
  try {
    await navigator.clipboard.writeText(addr);
    btn.textContent = '✓';
    btn.classList.add('copied');
    setTimeout(() => { btn.textContent = '📋'; btn.classList.remove('copied'); }, 1500);
  } catch {
    btn.textContent = '✗';
    setTimeout(() => { btn.textContent = '📋'; }, 1500);
  }
});
</script>
</html>`;
}
