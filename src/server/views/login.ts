export function renderLoginPage() {
  return `<!DOCTYPE html>
<html lang="zh">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>登录 - RgClaw</title>
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
      display: block;
      width: 100%;
      padding: 14px;
      border-radius: 10px;
      font-size: 15px;
      font-weight: 600;
      cursor: pointer;
      text-decoration: none;
      text-align: center;
      border: none;
      transition: all 0.2s;
    }
    .btn-wallet {
      background: linear-gradient(135deg, rgb(7, 193, 96) 0%, rgb(52, 211, 153) 100%);
      color: #fff;
      margin-bottom: 12px;
    }
    .btn-wallet:hover { opacity: 0.9; transform: translateY(-1px); }
    .btn-wallet:disabled { opacity: 0.6; cursor: not-allowed; }
    .wallet-hint { font-size: 13px; color: #666; text-align: center; }
    .error {
      background: rgba(239,68,68,0.1);
      border: 1px solid rgba(239,68,68,0.3);
      color: #fca5a5;
      padding: 10px 14px;
      border-radius: 8px;
      font-size: 13px;
      margin-bottom: 16px;
      display: none;
    }
    .back {
      display: block;
      text-align: center;
      margin-top: 20px;
      color: #444;
      text-decoration: none;
      font-size: 13px;
    }
    .back:hover { color: #888; }
  </style>
</head>
<body>
  <div class="card">
    <h1>登录 RgClaw</h1>
    <p class="subtitle">连接钱包即可登录，无需密码</p>
    
    <div id="error-msg" class="error"></div>
    
    <button class="btn btn-wallet" id="connect-wallet-btn">
      🔗 连接钱包登录
    </button>
    <p class="wallet-hint">支持 MetaMask、WalletConnect 等钱包</p>
  </div>
  <a href="/" class="back">← 返回首页</a>

  <script>
    const errorMsg = document.getElementById('error-msg');
    const connectBtn = document.getElementById('connect-wallet-btn');
    
    connectBtn.addEventListener('click', async () => {
      errorMsg.style.display = 'none';
      connectBtn.disabled = true;
      connectBtn.textContent = '连接中...';
      
      try {
        if (typeof window.ethereum === 'undefined') {
          throw new Error('请安装 MetaMask 或其他 Web3 钱包');
        }
        
        const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
        const walletAddress = accounts[0];
        
        const res = await fetch('/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ wallet: walletAddress }),
        });
        
        if (res.ok || res.redirected) {
          location.href = res.headers.get('location') || '/me';
        } else {
          const text = await res.text();
          throw new Error(text || '登录失败');
        }
      } catch (e) {
        errorMsg.textContent = e.message || '连接失败，请重试';
        errorMsg.style.display = 'block';
        connectBtn.disabled = false;
        connectBtn.textContent = '🔗 连接钱包登录';
      }
    });
  </script>
</body>
</html>`;
}
