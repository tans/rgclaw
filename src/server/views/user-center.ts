import type { SubscriptionRecord } from "../../db/repositories/subscriptions";

type RenderUserCenterInput = {
  email: string;
  walletAddress: string;
  subscriptions: SubscriptionRecord[];
  entitlementText: string;
  bindingStatusText: string;
  bound: boolean;
};

export function renderUserCenter(input: RenderUserCenterInput) {
  const subscriptionItems = input.subscriptions
    .map(
      (s) =>
        `<div class="sub-item ${s.enabled ? "on" : "off"}">
          <span class="sub-source">${s.source === "four" ? "Four" : s.source === "flap" ? "Flap" : s.source}</span>
          <span class="sub-status">${s.enabled ? "已开启" : "已关闭"}</span>
        </div>`,
    )
    .join("");

  return `<!DOCTYPE html>
<html lang="zh">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>用户中心</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #f5f5f5; color: #333; }
  .container { max-width: 540px; margin: 40px auto; padding: 0 20px; }
  .card { background: #fff; border-radius: 12px; padding: 24px; box-shadow: 0 2px 12px rgba(0,0,0,0.06); margin-bottom: 16px; }
  h1 { font-size: 20px; font-weight: 700; margin-bottom: 20px; }
  .info-row { display: flex; justify-content: space-between; align-items: center; padding: 12px 0; border-bottom: 1px solid #f0f0f0; }
  .info-row:last-child { border-bottom: none; }
  .info-label { font-size: 14px; color: #888; }
  .info-value { font-size: 14px; font-weight: 500; }
  .badge { display: inline-block; background: #e8f5e9; color: #2e7d32; padding: 3px 10px; border-radius: 12px; font-size: 13px; }
  .badge.warn { background: #fff3e0; color: #e65100; }
  .btn { display: inline-block; background: #0070f0; color: #fff; border: none; border-radius: 8px; padding: 10px 20px; font-size: 14px; cursor: pointer; text-decoration: none; }
  .btn:hover { background: #0062cc; }
  .sub-item { display: flex; justify-content: space-between; align-items: center; padding: 10px 0; border-bottom: 1px solid #f5f5f5; }
  .sub-item:last-child { border-bottom: none; }
  .sub-source { font-weight: 600; }
  .sub-status { font-size: 13px; color: #888; }
  .sub-item.on .sub-status { color: #2e7d32; }
  .section-title { font-size: 13px; color: #888; margin-bottom: 12px; text-transform: uppercase; letter-spacing: 0.5px; }
  a { color: #0070f0; text-decoration: none; }
</style>
</head>
<body>
<div class="container">
  <div class="card">
    <h1>👤 用户中心</h1>
    <div class="info-row">
      <span class="info-label">邮箱</span>
      <span class="info-value">${input.email}</span>
    </div>
    <div class="info-row">
      <span class="info-label">钱包地址</span>
      <span class="info-value" style="font-size:12px;font-family:monospace">${input.walletAddress || "<a href='/renew'>去填写</a>"}</span>
    </div>
    <div class="info-row">
      <span class="info-label">微信绑定</span>
      <span class="info-value">
        ${input.bound
          ? `<span class="badge">✅ 已绑定</span>`
          : `<span class="badge warn">⚠️ 未绑定</span> <a href="/wechat/bind">去绑定 →</a>`}
      </span>
    </div>
    <div class="info-row">
      <span class="info-label">订阅状态</span>
      <span class="info-value">${input.entitlementText}</span>
    </div>
  </div>

  <div class="card">
    <div class="section-title">事件来源</div>
    ${subscriptionItems || "<p style='color:#888;font-size:13px;'>暂无订阅</p>"}
  </div>

  <div class="card">
    <div class="section-title">快捷操作</div>
    <div style="display:flex;gap:10px;flex-wrap:wrap;">
      <a href="/wechat/bind" class="btn">${input.bound ? "查看绑定" : "绑定微信"}</a>
      <a href="/renew" class="btn" style="background:#f0f0f0;color:#333;">续费</a>
    </div>
  </div>
</div>
</body>
</html>`;
}
