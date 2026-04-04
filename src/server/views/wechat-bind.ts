export function renderWechatBindPage(props: {
  hubConnected: boolean;
  hubOAuthUrl: string;
  qrCodeUrl: string | null;
  bindingStatus: "idle" | "waiting" | "bound" | "error";
  errorMessage?: string;
  botName?: string;
  boundAt?: string;
}) {
  const { hubConnected, hubOAuthUrl, qrCodeUrl, bindingStatus, errorMessage, botName, boundAt } = props;

  return `<!DOCTYPE html>
<html lang="zh">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>绑定微信</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #f5f5f5; color: #333; }
  .container { max-width: 480px; margin: 60px auto; padding: 0 20px; }
  .card { background: #fff; border-radius: 12px; padding: 32px; box-shadow: 0 2px 12px rgba(0,0,0,0.08); }
  h1 { font-size: 22px; margin-bottom: 8px; }
  .subtitle { color: #666; font-size: 14px; margin-bottom: 28px; }
  .step { display: flex; gap: 16px; margin-bottom: 24px; }
  .step-num { width: 28px; height: 28px; border-radius: 50%; background: #e8e8e8; color: #999; font-size: 14px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
  .step-num.active { background: #0070f0; color: #fff; }
  .step-num.done { background: #34c759; color: #fff; }
  .step-content { padding-top: 4px; }
  .step-title { font-size: 15px; font-weight: 600; }
  .step-desc { font-size: 13px; color: #888; margin-top: 2px; }
  .btn { display: inline-block; background: #0070f0; color: #fff; border: none; border-radius: 8px; padding: 12px 24px; font-size: 15px; cursor: pointer; text-decoration: none; text-align: center; width: 100%; }
  .btn:hover { background: #0062cc; }
  .btn:disabled { background: #ccc; cursor: not-allowed; }
  .btn-secondary { background: #f0f0f0; color: #333; margin-top: 10px; }
  .qr-wrap { text-align: center; margin: 20px 0; }
  .qr-wrap img { border: 1px solid #eee; border-radius: 8px; max-width: 200px; }
  .status-msg { text-align: center; padding: 16px; border-radius: 8px; font-size: 14px; margin: 16px 0; }
  .status-waiting { background: #fff8e6; color: #92600a; }
  .status-bound { background: #e8f5e9; color: #2e7d32; }
  .status-error { background: #ffebee; color: #c62828; }
  .divider { border: none; border-top: 1px solid #eee; margin: 24px 0; }
  .info-row { display: flex; justify-content: space-between; font-size: 13px; color: #666; margin-bottom: 8px; }
  .back-link { display: block; text-align: center; margin-top: 20px; color: #0070f0; text-decoration: none; font-size: 14px; }
</style>
</head>
<body>
<div class="container">
  <div class="card">
    <h1>绑定微信</h1>
    <p class="subtitle">扫码后，事件通知将发送到你的微信</p>

    <!-- Step 1: Connect Hub -->
    <div class="step">
      <div class="step-num ${hubConnected ? "done" : "active"}">${hubConnected ? "✓" : "1"}</div>
      <div class="step-content">
        <div class="step-title">连接 OpeniLink Hub</div>
        ${hubConnected
          ? `<div class="step-desc">已连接</div>`
          : `<div class="step-desc">使用 GitHub 账号授权</div>`}
      </div>
    </div>

    <!-- Step 2: Bind WeChat -->
    <div class="step">
      <div class="step-num ${!hubConnected ? "" : bindingStatus === "bound" ? "done" : "active"}">${!hubConnected ? "2" : bindingStatus === "bound" ? "✓" : "2"}</div>
      <div class="step-content">
        <div class="step-title">扫码绑定微信</div>
        <div class="step-desc">用微信扫描机器人二维码</div>
      </div>
    </div>

    <hr class="divider"/>

    ${!hubConnected ? `
      <a href="${hubOAuthUrl}" class="btn">连接 Hub 继续</a>
    ` : bindingStatus === "idle" && qrCodeUrl === null ? `
      <p style="font-size:13px;color:#666;margin-bottom:16px;">连接 Hub 后，扫码绑定微信机器人</p>
      <button id="start-bind-btn" class="btn">开始绑定</button>
      <div id="qr-section" style="display:none;">
        <p style="font-size:13px;color:#666;margin-bottom:16px;">请用微信扫描下方二维码</p>
        <div class="qr-wrap">
          <img id="qr-img" src="" alt="QR Code" />
        </div>
        <div id="bind-status" class="status-msg status-waiting">等待扫码确认...</div>
      </div>
      <a href="/me" class="back-link">返回用户中心</a>
    ` : bindingStatus === "idle" && qrCodeUrl ? `
      <p style="font-size:13px;color:#666;margin-bottom:16px;">请用微信扫描下方二维码</p>
      <div class="qr-wrap">
        <img src="${qrCodeUrl}" alt="QR Code" />
      </div>
      <div id="bind-status" class="status-msg status-waiting">等待扫码确认...</div>
      <button id="refresh-btn" class="btn btn-secondary">刷新二维码</button>
      <a href="/me" class="back-link">返回用户中心</a>
    ` : bindingStatus === "waiting" ? `
      <div class="qr-wrap">
        <img src="${qrCodeUrl ?? ""}" alt="QR Code" />
      </div>
      <div class="status-msg status-waiting">✅ 已扫码，请确认...</div>
      <a href="/me" class="back-link">返回用户中心</a>
    ` : bindingStatus === "bound" ? `
      <div class="status-msg status-bound">
        ✅ 绑定成功！机器人：${botName ?? "未知"}
        ${boundAt ? `<br/><span style="font-size:12px;color:#888;">绑定时间：${boundAt}</span>` : ""}
      </div>
      <p style="font-size:13px;color:#666;margin-bottom:16px;">你已可以收到 four / flap 事件通知了。</p>
      <a href="/me" class="btn">前往用户中心</a>
    ` : errorMessage ? `
      <div class="status-msg status-error">${errorMessage}</div>
      <button id="retry-btn" class="btn">重新绑定</button>
    ` : ""}
  </div>
</div>

<script>
const bindingStatus = "${bindingStatus}";

async function pollBindConfirm() {
  if (bindingStatus !== "waiting") return;
  try {
    const res = await fetch("/wechat/bind/confirm", { method: "POST" });
    const data = await res.json();
    if (data.ok) {
      location.href = data.redirectUrl || '/me?bound=1';
    }
  } catch(e) {}
  setTimeout(pollBindConfirm, 2000);
}

if (bindingStatus === "waiting") {
  pollBindConfirm();
}

async function startBind() {
  const btn = document.getElementById("start-bind-btn");
  if (btn) { btn.disabled = true; btn.textContent = "请稍候..."; }
  try {
    const res = await fetch("/wechat/bind/start", { method: "POST" });
    const data = await res.json();
    if (data.qrCodeUrl) {
      const qrSection = document.getElementById("qr-section");
      const qrImg = document.getElementById("qr-img");
      const statusMsg = document.getElementById("bind-status");
      if (qrSection) qrSection.style.display = "block";
      if (qrImg) qrImg.src = data.qrCodeUrl;
      if (btn && btn.parentElement) btn.parentElement.style.display = "none";
      // Start polling
      (function poll() {
        fetch("/wechat/bind/confirm", { method: "POST" })
          .then(r => r.json())
          .then(d => {
            if (d.ok) { location.href = d.redirectUrl || '/me?bound=1'; return; }
          })
          .catch(() => {})
          .finally(() => { setTimeout(poll, 2000); });
      })();
    } else if (data.error) {
      if (btn) { btn.disabled = false; btn.textContent = "开始绑定"; }
      alert(data.error);
    }
  } catch(e) {
    if (btn) { btn.disabled = false; btn.textContent = "开始绑定"; }
  }
}

document.getElementById("start-bind-btn")?.addEventListener("click", startBind);

document.getElementById("refresh-btn")?.addEventListener("click", async () => {
  const res = await fetch("/wechat/bind/start", { method: "POST" });
  const data = await res.json();
  if (data.qrCodeUrl) {
    location.reload();
  }
});

document.getElementById("retry-btn")?.addEventListener("click", async () => {
  const res = await fetch("/wechat/bind/start", { method: "POST" });
  const data = await res.json();
  if (data.qrCodeUrl) {
    location.reload();
  }
});
</script>
</body>
</html>`;
}
