import { Hono } from "hono";
import { getCookie } from "hono/cookie";
import { findSession } from "../../db/repositories/sessions";
import { 
  findActiveBindingByUserId, 
  createBinding,
  deactivateBinding 
} from "../../db/repositories/wechat-bot-bindings";
import { 
  startQRLogin, 
  getQRStatus, 
  clearQRStatus,
  sendMessage 
} from "../../services/wechatbot-service";
import type { AppEnv } from "../middleware/session";

export function wechatDirectRoutes() {
  const app = new Hono<AppEnv>();

  // GET /wechat/direct/bind - 检查绑定状态并返回页面
  app.get("/wechat/direct/bind", async (c) => {
    const sessionId = getCookie(c, "session_id");
    if (!sessionId) {
      return c.redirect("/auth/login", 302);
    }
    
    const session = findSession(sessionId);
    if (!session) {
      return c.redirect("/auth/login", 302);
    }
    
    const userId = session.user_id;
    const binding = findActiveBindingByUserId(userId);
    
    if (binding) {
      // 已绑定，显示绑定信息
      return c.html(renderBoundPage(binding));
    }
    
    // 未绑定，显示绑定页面
    return c.html(renderBindPage());
  });

  // POST /wechat/direct/qr/start - 开始QR绑定
  app.post("/wechat/direct/qr/start", async (c) => {
    const userId = c.get("sessionUserId");
    if (!userId) {
      return c.json({ error: "未登录" }, 401);
    }
    
    // 检查是否已有活跃绑定
    const existing = findActiveBindingByUserId(userId);
    if (existing) {
      return c.json({ error: "已绑定微信" }, 400);
    }
    
    try {
      const { qrCodeUrl, qrToken } = await startQRLogin(userId);
      return c.json({ qrCodeUrl, qrToken });
    } catch (err) {
      console.error("startQRLogin failed:", err);
      return c.json({ error: "启动绑定失败" }, 500);
    }
  });

  // GET /wechat/direct/qr/status - 查询绑定状态
  app.get("/wechat/direct/qr/status", async (c) => {
    const userId = c.get("sessionUserId");
    if (!userId) {
      return c.json({ error: "未登录" }, 401);
    }
    
    const status = getQRStatus(userId);
    if (!status) {
      return c.json({ status: "idle" });
    }
    
    // 如果已完成，保存到数据库
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
    
    return c.json({
      status: status.status,
      qrCodeUrl: status.qrCodeUrl,
      error: status.error,
    });
  });

  // DELETE /wechat/direct/bind - 解绑
  app.delete("/wechat/direct/bind", async (c) => {
    const userId = c.get("sessionUserId");
    if (!userId) {
      return c.json({ error: "未登录" }, 401);
    }
    
    const binding = findActiveBindingByUserId(userId);
    if (binding) {
      deactivateBinding(binding.id);
    }
    
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
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      background: #0a0a0f;
      color: #fff;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .card {
      background: rgba(255,255,255,0.04);
      border: 1px solid rgba(255,255,255,0.08);
      border-radius: 16px;
      padding: 40px;
      width: 100%;
      max-width: 400px;
      text-align: center;
    }
    h1 { font-size: 24px; font-weight: 700; margin-bottom: 8px; }
    .subtitle { color: #666; font-size: 14px; margin-bottom: 32px; }
    .btn {
      display: inline-block;
      background: linear-gradient(135deg, rgb(7, 193, 96) 0%, rgb(52, 211, 153) 100%);
      color: #fff;
      border: none;
      border-radius: 10px;
      padding: 14px 32px;
      font-size: 15px;
      font-weight: 600;
      cursor: pointer;
      text-decoration: none;
      width: 100%;
    }
    .btn:hover { opacity: 0.9; }
    .btn:disabled { opacity: 0.5; cursor: not-allowed; }
    .qr-wrap { margin: 24px 0; }
    .qr-wrap img { max-width: 200px; border-radius: 8px; }
    .status { padding: 16px; border-radius: 8px; font-size: 14px; margin: 16px 0; }
    .status-waiting { background: rgba(7, 193, 96, 0.1); color: rgb(7, 193, 96); }
    .status-success { background: rgba(34,197,94,0.1); color: #4ade80; }
    .status-error { background: rgba(239,68,68,0.1); color: #f87171; }
    .back-link { display: block; margin-top: 20px; color: #666; text-decoration: none; font-size: 14px; }
    .back-link:hover { color: #fff; }
  </style>
</head>
<body>
  <div class="card">
    <h1>绑定微信</h1>
    <p class="subtitle">扫码后，事件通知将发送到你的微信</p>
    
    <div id="qr-section" style="display:none;">
      <div class="qr-wrap">
        <img id="qr-img" src="" alt="微信二维码"/>
      </div>
      <div id="status" class="status status-waiting">等待扫码...</div>
    </div>
    
    <button id="start-btn" class="btn">开始绑定</button>
    <a href="/me" class="back-link">返回用户中心</a>
  </div>

  <script>
    const startBtn = document.getElementById('start-btn');
    const qrSection = document.getElementById('qr-section');
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
          qrSection.style.display = 'block';
          startBtn.style.display = 'none';
          
          // 开始轮询
          startPolling();
        } else {
          throw new Error(data.error || '获取二维码失败');
        }
      } catch (e) {
        statusDiv.textContent = e.message;
        statusDiv.className = 'status status-error';
        statusDiv.style.display = 'block';
        startBtn.disabled = false;
        startBtn.textContent = '重试';
      }
    });
    
    function startPolling() {
      if (polling) return;
      polling = true;
      
      const poll = async () => {
        try {
          const res = await fetch('/wechat/direct/qr/status');
          const data = await res.json();
          
          if (data.status === 'scanned') {
            statusDiv.textContent = '已扫码，请在微信中确认...';
          } else if (data.status === 'bound') {
            statusDiv.textContent = '绑定成功！';
            statusDiv.className = 'status status-success';
            setTimeout(() => location.href = data.redirect || '/wechat/direct/bind', 1000);
            return;
          } else if (data.status === 'expired') {
            statusDiv.textContent = '二维码已过期，请刷新重试';
            statusDiv.className = 'status status-error';
            startBtn.style.display = 'block';
            startBtn.disabled = false;
            startBtn.textContent = '重新绑定';
            polling = false;
            return;
          } else if (data.error) {
            statusDiv.textContent = data.error;
            statusDiv.className = 'status status-error';
          }
          
          if (polling) {
            setTimeout(poll, 2000);
          }
        } catch (e) {
          if (polling) setTimeout(poll, 2000);
        }
      };
      
      poll();
    }
  </script>
</body>
</html>`;
}

function renderBoundPage(binding: { bot_id: string; user_wx_id: string }) {
  return `<!DOCTYPE html>
<html lang="zh">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>微信已绑定 - RgClaw</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      background: #0a0a0f;
      color: #fff;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .card {
      background: rgba(255,255,255,0.04);
      border: 1px solid rgba(255,255,255,0.08);
      border-radius: 16px;
      padding: 40px;
      width: 100%;
      max-width: 400px;
      text-align: center;
    }
    h1 { font-size: 24px; font-weight: 700; margin-bottom: 8px; }
    .success-icon { font-size: 48px; margin-bottom: 16px; }
    .info { color: #666; font-size: 14px; margin: 16px 0; }
    .btn {
      display: inline-block;
      background: rgba(255,255,255,0.1);
      color: #fff;
      border: 1px solid rgba(255,255,255,0.2);
      border-radius: 10px;
      padding: 12px 24px;
      font-size: 14px;
      cursor: pointer;
      text-decoration: none;
      margin: 8px;
    }
    .btn-danger { background: rgba(239,68,68,0.1); border-color: rgba(239,68,68,0.3); color: #f87171; }
    .back-link { display: block; margin-top: 20px; color: #666; text-decoration: none; font-size: 14px; }
  </style>
</head>
<body>
  <div class="card">
    <div class="success-icon">✅</div>
    <h1>微信已绑定</h1>
    <p class="info">Bot ID: ${binding.bot_id.slice(0, 8)}...</p>
    <p class="info">你将收到 Four / Flap 事件通知</p>
    
    <button class="btn btn-danger" onclick="unbind()">解绑微信</button>
    <a href="/me" class="btn">返回用户中心</a>
  </div>

  <script>
    async function unbind() {
      if (!confirm('确定要解绑微信吗？')) return;
      
      try {
        const res = await fetch('/wechat/direct/bind', { method: 'DELETE' });
        if (res.ok) {
          location.reload();
        }
      } catch (e) {
        alert('解绑失败');
      }
    }
  </script>
</body>
</html>`;
}
