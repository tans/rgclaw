import type { SubscriptionRecord } from "../../db/repositories/subscriptions";
import type { LaunchEventFeedItem } from "../../db/repositories/launch-events";

type RenderUserCenterInput = {
  walletAddress: string;
  subscriptions: SubscriptionRecord[];
  recentEvents: LaunchEventFeedItem[];
  entitlementText: string;
  bindingStatusText: string;
  bound: boolean;
  justBound?: boolean;
  trialDaysLeft?: number;
};

function formatSource(source: string): string {
  const map: Record<string, string> = {
    four: "Four",
    flap: "Flap",
  };
  const name = map[source] || source;
  if (name.length > 12) {
    return name.slice(0, 12) + "...";
  }
  return name;
}

export function renderUserCenter(input: RenderUserCenterInput) {
  const subscriptionItems = input.subscriptions
    .map(
      (s) => `<form method="post" action="/me/subscription/toggle" class="sub-item-form">
      <input type="hidden" name="source" value="${s.source}" />
      <button type="submit" class="sub-item ${s.enabled ? "on" : "off"}">
        <span class="sub-source" title="${s.source}">${formatSource(s.source)}</span>
        <span class="sub-status">${s.enabled ? "已开启 ✓" : "已关闭"}</span>
      </button>
    </form>`,
    )
    .join("");

  const recentEventsHtml = input.recentEvents.length === 0
    ? `<p style="color:#888;text-align:center;padding:20px 0;">暂无发射事件</p>`
    : input.recentEvents.slice(0, 5).map((event) => {
        const time = new Date(event.event_time).toLocaleString("zh-CN", {
          month: "2-digit",
          day: "2-digit",
          hour: "2-digit",
          minute: "2-digit",
        });
        return `<div class="event-item">
  <div class="event-title">${event.title}</div>
  <div class="event-meta">
    <span class="event-source">${formatSource(event.source)}</span>
    <span class="event-time">${time}</span>
  </div>
  <div class="event-address">${event.token_address.slice(0, 8)}...${event.token_address.slice(-6)}</div>
</div>`;
      }).join("");

  return `<!DOCTYPE html>
<html lang="zh">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>用户中心</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      background: #f5f5f5;
      color: #333;
    }
    .container {
      max-width: 540px;
      margin: 40px auto;
      padding: 0 20px;
    }
    .card {
      background: #fff;
      border-radius: 12px;
      padding: 24px;
      box-shadow: 0 2px 12px rgba(0,0,0,0.06);
      margin-bottom: 16px;
    }
    h1 {
      font-size: 20px;
      font-weight: 700;
      margin-bottom: 20px;
    }
    .info-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 12px 0;
      border-bottom: 1px solid #f0f0f0;
    }
    .info-row:last-child { border-bottom: none; }
    .info-label { font-size: 14px; color: #888; }
    .info-value { font-size: 14px; font-weight: 500; }
    .badge {
      display: inline-block;
      background: #e8f5e9;
      color: #2e7d32;
      padding: 3px 10px;
      border-radius: 12px;
      font-size: 13px;
    }
    .badge.warn { background: #fff3e0; color: #e65100; }
    .btn {
      display: inline-block;
      background: #0070f0;
      color: #fff;
      border: none;
      border-radius: 8px;
      padding: 10px 20px;
      font-size: 14px;
      cursor: pointer;
      text-decoration: none;
    }
    .btn:hover { background: #0062cc; }
    .sub-item {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 10px 0;
      border-bottom: 1px solid #f5f5f5;
    }
    .sub-item:last-child { border-bottom: none; }
    .sub-source {
      font-weight: 600;
      max-width: 200px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .sub-status { font-size: 13px; color: #888; }
    .sub-item.on .sub-status { color: #2e7d32; }
    .sub-item-form {
      margin: 0;
      padding: 0;
    }
    .sub-item-form button {
      width: 100%;
      background: none;
      border: none;
      cursor: pointer;
      text-align: left;
      font-family: inherit;
      font-size: inherit;
    }
    .sub-item-form button:hover {
      background: #f9f9f9;
    }
    .sub-item-form button:active {
      background: #f0f0f0;
    }
    .section-title {
      font-size: 13px;
      color: #888;
      margin-bottom: 12px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    a { color: #0070f0; text-decoration: none; }
    .banner {
      background: linear-gradient(135deg, rgb(7, 193, 96), rgb(52, 211, 153));
      border-radius: 12px;
      padding: 20px 24px;
      margin-bottom: 16px;
      color: #fff;
    }
    .banner h2 { font-size: 16px; font-weight: 700; margin-bottom: 6px; }
    .banner p {
      font-size: 13px;
      opacity: 0.88;
      line-height: 1.55;
      margin-bottom: 14px;
    }
    .banner .btn {
      background: rgba(255,255,255,0.2);
      border: 1px solid rgba(255,255,255,0.3);
      backdrop-filter: blur(4px);
      padding: 10px 20px;
      font-size: 14px;
    }
    .banner .btn:hover { background: rgba(255,255,255,0.3); }
    .banner.success { background: linear-gradient(135deg, #059669, #10b981); }
    .banner.warning { background: linear-gradient(135deg, #d97706, #f59e0b); }
    .checklist { margin-top: 20px; }
    .check-item {
      display: flex;
      gap: 10px;
      align-items: flex-start;
      padding: 10px 0;
      border-bottom: 1px solid rgba(255,255,255,0.1);
      font-size: 13px;
    }
    .check-item:last-child { border-bottom: none; }
    .check-icon {
      width: 20px;
      height: 20px;
      border-radius: 50%;
      flex-shrink: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 11px;
      margin-top: 1px;
    }
    .check-icon.done { background: rgba(255,255,255,0.25); color: #fff; }
    .check-icon.pending { background: rgba(255,255,255,0.15); color: rgba(255,255,255,0.6); }
    .events { display: flex; flex-direction: column; gap: 8px; }
    .event-item {
      background: #fafafa;
      border: 1px solid #eee;
      border-radius: 8px;
      padding: 12px 14px;
    }
    .event-item:hover { border-color: #ddd; }
    .event-title {
      font-size: 14px;
      font-weight: 600;
      margin-bottom: 4px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .event-meta {
      display: flex;
      gap: 8px;
      font-size: 12px;
      color: #666;
      margin-bottom: 4px;
    }
    .event-source {
      background: rgba(7, 193, 96, 0.1);
      color: rgb(7, 193, 96);
      padding: 1px 6px;
      border-radius: 4px;
      font-size: 11px;
      max-width: 120px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .event-time { color: #999; }
    .event-address {
      font-size: 11px;
      color: #999;
      font-family: monospace;
    }
    #errorModal {
      display: none;
      position: fixed;
      top: 0; left: 0; right: 0; bottom: 0;
      background: rgba(0,0,0,0.5);
      align-items: center;
      justify-content: center;
      z-index: 9999;
    }
    #errorModal.show { display: flex; }
    .modal-box {
      background: #fff;
      border-radius: 12px;
      padding: 28px 24px;
      max-width: 360px;
      width: 90%;
      text-align: center;
    }
    .modal-box h3 { margin: 0 0 12px; font-size: 16px; color: #333; }
    .modal-box p { margin: 0 0 20px; font-size: 14px; color: #666; word-break: break-all; }
    .modal-box button {
      background: rgb(7,193,96);
      color: #fff;
      border: none;
      border-radius: 8px;
      padding: 10px 32px;
      font-size: 14px;
      cursor: pointer;
    }
    .modal-box button:hover { opacity: 0.85; }
  </style>
</head>
<body>
  <nav style="padding:16px 20px;display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid #eee;margin-bottom:16px;background:#fff;">
    <a href="/" style="font-size:16px;font-weight:700;color:#333;text-decoration:none;"><span style="color:rgb(7,193,96)">regou</span>.app</a>
    <form method="POST" action="/logout" style="margin:0;">
      <button type="submit" style="background:none;border:none;color:#888;font-size:13px;cursor:pointer;">登出</button>
    </form>
  </nav>
  <div class="container">
    ${input.justBound ? `
    <div class="banner success">
      <h2>🎉 绑定成功！</h2>
      <p>你的微信已成功连接。从现在起，Four / Flap 发射事件会第一时间推送到你的微信。</p>
    </div>
    ` : !input.bound ? `
    <div class="banner">
      <h2>👋 欢迎使用 Regou.app！</h2>
      <p>完成以下步骤，开始接收 Meme 发射通知：</p>
      <div class="checklist">
        <div class="check-item">
          <div class="check-icon done">✓</div>
          <div>注册账号</div>
        </div>
        <div class="check-item">
          <div class="check-icon pending">2</div>
          <div>连接钱包登录</div>
        </div>
        <div class="check-item">
          <div class="check-icon pending">3</div>
          <div>扫码绑定微信机器人</div>
        </div>
      </div>
      <br/>
      <a href="/wechat/direct/bind" class="btn">立即绑定微信 →</a>
    </div>
    ` : input.trialDaysLeft !== undefined && input.trialDaysLeft >= 0 && input.trialDaysLeft <= 1 ? `
    <div class="banner warning">
      <h2>⏰ 试用即将到期</h2>
      <p>你的 3 天免费试用还剩 ${input.trialDaysLeft === 0 ? "今天" : "最后 1 天"}。到期后将停止推送，及时续费可确保服务不中断。</p>
      <a href="/renew" class="btn">立即续费 →</a>
    </div>
    ` : ""}

    <div class="card">
      <div class="info-row">
        <span class="info-label">钱包</span>
        <span class="info-value" style="font-size:12px;font-family:monospace">${input.walletAddress ? input.walletAddress.slice(0,8)+"..."+input.walletAddress.slice(-6) : "未填写"}</span>
      </div>
      <div class="info-row">
        <span class="info-label">微信</span>
        <span class="info-value">${input.bound ? "✅ 已绑定" : "⚠️ 未绑定"}</span>
      </div>
      <div id="botStatusRow" class="info-row" style="display:none">
        <span class="info-label">机器人</span>
        <span id="botStatusValue" class="info-value">检查中...</span>
      </div>
      <div class="info-row">
        <span class="info-label">订阅</span>
        <span class="info-value">${input.entitlementText}</span>
      </div>
      <div style="display:flex;gap:8px;margin-top:16px;flex-wrap:wrap;justify-content:center;">
        ${input.bound ? `<button id="sendMsgBtn" class="btn" style="background:rgb(7,193,96);flex:1;text-align:center;">发送消息</button>` : ""}
        <a href="/wechat/direct/bind" class="btn" style="background:#f0f0f0;color:#333;flex:1;text-align:center;">${input.bound ? "重新绑定" : "绑定微信"}</a>
        <a href="/renew" class="btn" style="background:#f0f0f0;color:#333;flex:1;text-align:center;">续费</a>
      </div>
    </div>

    ${input.bound ? `
    <script>
    // Poll bot status
    (async function() {
      const row = document.getElementById("botStatusRow");
      const val = document.getElementById("botStatusValue");
      if (!row || !val) return;
      row.style.display = "flex";
      try {
        const res = await fetch("/me/bot-status");
        if (!res.ok) { val.textContent = "⚠️ 检查失败"; val.style.color = "#e00"; return; }
        const data = await res.json();
        if (data.bound) {
          if (data.online) {
            val.textContent = "🟢 在线";
            val.style.color = "rgb(7,193,96)";
          } else {
            val.textContent = "⚠️ 离线（请重新绑定）";
            val.style.color = "#e07000";
          }
        } else {
          row.style.display = "none";
        }
      } catch { val.textContent = "⚠️ 检查失败"; val.style.color = "#e00"; }
    })();

    document.getElementById("sendMsgBtn")?.addEventListener("click", async () => {
      const btn = document.getElementById("sendMsgBtn");
      if (!btn) return;
      btn.disabled = true;
      btn.textContent = "发送中...";
      try {
        const res = await fetch("/me/send-message", { method: "POST" });
        const data = await res.json();
        if (data.ok) {
          btn.textContent = "已发送 " + data.emoji;
          setTimeout(() => { btn.textContent = "发送消息"; btn.disabled = false; }, 1500);
        } else {
          document.getElementById("errorModalMsg").textContent = data.error || "发送失败";
          document.getElementById("errorModal").classList.add("show");
          setTimeout(() => { btn.textContent = "发送消息"; btn.disabled = false; }, 1500);
        }
      } catch {
        document.getElementById("errorModalMsg").textContent = "发送失败，请稍后重试";
        document.getElementById("errorModal").classList.add("show");
        setTimeout(() => { btn.textContent = "发送消息"; btn.disabled = false; }, 1500);
      }
    });
    </script>
    ` : ""}

    ${input.bound ? `
    <div class="card">
      <div class="section-title">监听事件</div>
      ${subscriptionItems || "<p style='color:#888;font-size:13px;'>暂无订阅</p>"}
    </div>
    ` : ""}
  </div>
  <div id="errorModal">
    <div class="modal-box">
      <h3>发送失败</h3>
      <p id="errorModalMsg"></p>
      <button onclick="document.getElementById('errorModal').classList.remove('show')">好的</button>
    </div>
  </div>
</body>
</html>`;
}
