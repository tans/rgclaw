import { Hono } from "hono";
import { getCookie } from "hono/cookie";
import QRCode from "qrcode";
import { findSession } from "../../db/repositories/sessions";
import { findActiveBindingByUserId, createBinding, deactivateBinding } from "../../db/repositories/wechat-bot-bindings";
import { startQRLogin, getQRStatus, clearQRStatus } from "../../services/wechatbot-service";
import type { AppEnv } from "../middleware/session";

export function wechatDirectRoutes() {
  const app = new Hono<AppEnv>();

  app.get("/wechat/direct/bind", async (c) => {
    const sessionId = getCookie(c, "session_id");
    if (!sessionId) return c.redirect("/auth/login", 302);
    const session = findSession(sessionId);
    if (!session) return c.redirect("/auth/login", 302);
    const binding = findActiveBindingByUserId(session.user_id);
    if (binding) return c.html(renderBoundPage(binding));
    return c.html(renderBindPage());
  });

  app.post("/wechat/direct/qr/start", async (c) => {
    const userId = c.get("sessionUserId");
    if (!userId) return c.json({ error: "未登录" }, 401);
    const existing = findActiveBindingByUserId(userId);
    if (existing) return c.json({ error: "已绑定微信" }, 400);
    try {
      const { qrCodeUrl } = await startQRLogin(userId);
      const qrDataUrl = await QRCode.toDataURL(qrCodeUrl, { width: 256, margin: 2 });
      return c.json({ qrCodeUrl: qrDataUrl });
    } catch (err) {
      console.error("startQRLogin failed:", err);
      return c.json({ error: "启动绑定失败" }, 500);
    }
  });

  app.get("/wechat/direct/qr/status", async (c) => {
    const userId = c.get("sessionUserId");
    if (!userId) return c.json({ error: "未登录" }, 401);
    const status = getQRStatus(userId);
    if (!status) return c.json({ status: "idle" });
    if (status.status === "confirmed" && status.credentials) {
      const existing = findActiveBindingByUserId(userId);
      if (!existing) {
        createBinding({
          id: crypto.randomUUID(),
          user_id: userId,
          bot_token: status.credentials.botToken,
          bot_id: status.credentials.botId,
          account_id: status.credentials.accountId,
          user_wx_id: status.credentials.userWxId,
          base_url: status.credentials.baseUrl,
        });
        clearQRStatus(userId);
        return c.json({ status: "bound", redirect: "/wechat/direct/bind" });
      }
    }
    return c.json({ status: status.status, qrCodeUrl: status.qrCodeUrl, error: status.error });
  });

  app.delete("/wechat/direct/bind", async (c) => {
    const userId = c.get("sessionUserId");
    if (!userId) return c.json({ error: "未登录" }, 401);
    const binding = findActiveBindingByUserId(userId);
    if (binding) deactivateBinding(binding.id);
    return c.json({ ok: true });
  });

  return app;
}

function renderBindPage() {
  return `<!DOCTYPE html>
<html lang="zh">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>绑定微信 - RgClaw</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #0a0a0f; color: #fff; min-height: 100vh; display: flex; align-items: center; justify-content: center; }
    .card { background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.08); border-radius: 16px; padding: 40px; width: 100%; max-width: 400px; text-align: center; }
    h1 { font-size: 24px; font-weight: 700; margin-bottom: 8px; }
    .subtitle { color: #666; font-size: 14px; margin-bottom: 32px; }
    .btn { background: rgb(7, 193, 96); color: #fff; border: none; border-radius: 10px; padding: 14px 32px; font-size: 15px; font-weight: 600; cursor: pointer; width: 100%; transition: background 0.2s; }
    .btn:hover { background: rgb(6, 174, 86); }
    .btn:disabled { background: #333; cursor: not-allowed; }
    .qr-section { margin-top: 24px; }
    .qr-wrap { background: #fff; padding: 16px; border-radius: 12px; display: inline-block; margin: 16px 0; }
    .qr-wrap img { width: 200px; height: 200px; display: block; }
    .status { font-size: 14px; color: #888; margin-top: 16px; }
    .status.waiting { color: rgb(7, 193, 96); }
    .status.error { color: #ef4444; }
    .back-link { display: block; margin-top: 24px; color: #666; text-decoration: none; font-size: 14px; }
    .back-link:hover { color: #fff; }
  </style>
</head>
<body>
  <div class="card">
    <h1>绑定微信</h1>
    <p class="subtitle">扫码后，事件通知将发送到你的微信</p>
    <button id="start-btn" class="btn">开始绑定</button>
    <div id="qr-section" class="qr-section" style="display:none;">
      <p style="font-size:13px;color:#666;margin-bottom:12px;">请用微信扫描下方二维码</p>
      <div class="qr-wrap">
        <img id="qr-img" src="" alt="微信登录二维码" />
      </div>
      <div id="status" class="status"></div>
    </div>
    <a href="/me" class="back-link">返回用户中心</a>
  </div>
  <script>
    const startBtn = document.getElementById('start-btn');
    const qrImg = document.getElementById('qr-img');
    const statusDiv = document.getElementById('status');
    let polling = false;
    startBtn.addEventListener('click', async () => {
      startBtn.disabled = true;
      startBtn.textContent = '请稍候...';
      try {
        const res = await fetch('/wechat/direct/qr/start', { method: 'POST' });
        const data = await res.json();
        if (data.qrCodeUrl) {
          qrImg.src = data.qrCodeUrl;
          document.getElementById('qr-section').style.display = 'block';
          startBtn.style.display = 'none';
          statusDiv.textContent = '等待扫码...';
          statusDiv.className = 'status waiting';
          startPolling();
        } else if (data.error) {
          statusDiv.textContent = data.error;
          statusDiv.className = 'status error';
          startBtn.disabled = false;
          startBtn.textContent = '重试';
        }
      } catch (err) {
        statusDiv.textContent = '网络错误，请重试';
        statusDiv.className = 'status error';
        startBtn.disabled = false;
        startBtn.textContent = '重试';
      }
    });
    function startPolling() {
      if (polling) return;
      polling = true;
      async function poll() {
        try {
          const res = await fetch('/wechat/direct/qr/status');
          const data = await res.json();
          if (data.status === 'scanned') {
            statusDiv.textContent = '已扫码，请确认登录...';
          } else if (data.status === 'bound') {
            statusDiv.textContent = '绑定成功！';
            setTimeout(() => location.href = '/wechat/direct/bind', 1000);
            return;
          } else if (data.status === 'error') {
            statusDiv.textContent = data.error || '绑定失败';
            statusDiv.className = 'status error';
            polling = false;
            return;
          }
          if (polling) setTimeout(poll, 2000);
        } catch (err) { if (polling) setTimeout(poll, 2000); }
      }
      poll();
    }
  </script>
</body>
</html>`;
}

function renderBoundPage(binding: { bot_id: string; bound_at: string }) {
  return `<!DOCTYPE html>
<html lang="zh">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>微信已绑定 - RgClaw</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #0a0a0f; color: #fff; min-height: 100vh; display: flex; align-items: center; justify-content: center; }
    .card { background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.08); border-radius: 16px; padding: 40px; width: 100%; max-width: 400px; text-align: center; }
    h1 { font-size: 24px; font-weight: 700; margin-bottom: 8px; }
    .success-icon { width: 64px; height: 64px; background: rgba(7, 193, 96, 0.15); border-radius: 50%; display: flex; align-items: center; justify-content: center; margin: 0 auto 24px; font-size: 32px; }
    .info { color: #666; font-size: 14px; margin-bottom: 8px; }
    .info-value { color: #fff; font-weight: 500; }
    .back-link { display: block; margin-top: 24px; color: rgb(7, 193, 96); text-decoration: none; font-size: 14px; }
  </style>
</head>
<body>
  <div class="card">
    <div class="success-icon">✓</div>
    <h1>绑定成功</h1>
    <p class="info">机器人 ID</p>
    <p class="info-value">${binding.bot_id}</p>
    <p class="info" style="margin-top:16px;">绑定时间</p>
    <p class="info-value">${new Date(binding.bound_at).toLocaleString('zh-CN')}</p>
    <p style="color:#888;font-size:13px;margin-top:24px;">你将收到 Four 和 Flap 的发射事件通知</p>
    <a href="/me" class="back-link">返回用户中心</a>
  </div>
</body>
</html>`;
}
