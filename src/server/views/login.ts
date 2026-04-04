export function renderLoginPage() {
  return `<!DOCTYPE html>
<html lang="zh">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>登录 / 注册</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #0a0a0f; color: #fff; min-height: 100vh; display: flex; align-items: center; justify-content: center; }
  .card { background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.08); border-radius: 16px; padding: 40px; width: 100%; max-width: 400px; }
  h1 { font-size: 24px; font-weight: 700; margin-bottom: 8px; }
  .subtitle { color: #666; font-size: 14px; margin-bottom: 32px; }
  .btn { display: block; width: 100%; padding: 14px; border-radius: 10px; font-size: 15px; font-weight: 600; cursor: pointer; text-decoration: none; text-align: center; border: none; transition: all 0.2s; }
  .btn-github { background: #fff; color: #111; margin-bottom: 12px; }
  .btn-github:hover { background: #f0f0f0; }
  .divider { display: flex; align-items: center; gap: 12px; margin: 24px 0; color: #444; font-size: 12px; }
  .divider::before, .divider::after { content: ''; flex: 1; height: 1px; background: rgba(255,255,255,0.08); }
  input { width: 100%; padding: 12px 14px; background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.1); border-radius: 8px; color: #fff; font-size: 14px; outline: none; transition: border-color 0.2s; box-sizing: border-box; margin-bottom: 10px; }
  input:focus { border-color: #6366f1; }
  input::placeholder { color: #555; }
  .btn-submit { background: #6366f1; color: #fff; margin-bottom: 8px; }
  .btn-submit:hover { background: #4f52d8; }
  .toggle { text-align: center; font-size: 13px; color: #555; margin-top: 16px; }
  .toggle a { color: #818cf8; text-decoration: none; }
  .error { background: rgba(239,68,68,0.1); border: 1px solid rgba(239,68,68,0.3); color: #fca5a5; padding: 10px 14px; border-radius: 8px; font-size: 13px; margin-bottom: 16px; display: none; }
  .back { display: block; text-align: center; margin-top: 20px; color: #444; text-decoration: none; font-size: 13px; }
  .back:hover { color: #888; }
</style>
</head>
<body>
<div class="card">
  <h1>登录 RgClaw</h1>
  <p class="subtitle">免费试用 3 天，之后按月或按年订阅</p>

  <a href="/auth/oauth/github" class="btn btn-github">Continue with GitHub</a>

  <div class="divider">或</div>

  <div id="error-msg" class="error"></div>

  <form id="auth-form" method="POST">
    <input type="email" name="email" placeholder="邮箱" required />
    <input type="password" name="password" placeholder="密码" required />
    <button type="submit" class="btn btn-submit" id="submit-btn">登录</button>
  </form>

  <div class="toggle">
    没有账号？<a href="#" id="toggle-btn">立即注册</a>
  </div>
</div>

<a href="/" class="back">← 返回首页</a>

<script>
const form = document.getElementById('auth-form');
const errorMsg = document.getElementById('error-msg');
const submitBtn = document.getElementById('submit-btn');
const toggleBtn = document.getElementById('toggle-btn');
let isRegister = false;

toggleBtn.addEventListener('click', (e) => {
  e.preventDefault();
  isRegister = !isRegister;
  form.action = isRegister ? '/register' : '/login';
  submitBtn.textContent = isRegister ? '注册' : '登录';
  toggleBtn.textContent = isRegister ? '返回登录' : '立即注册';
  document.querySelector('.divider + .toggle').innerHTML = isRegister
    ? '已有账号？<a href="#" id="toggle-btn">立即登录</a>'
    : '没有账号？<a href="#" id="toggle-btn">立即注册</a>';
  document.querySelector('.divider + .toggle').querySelector('a').addEventListener('click', (e) => {
    e.preventDefault();
    isRegister = !isRegister;
    form.action = isRegister ? '/register' : '/login';
    submitBtn.textContent = isRegister ? '注册' : '登录';
    document.querySelector('.divider + .toggle').innerHTML = isRegister
      ? '已有账号？<a href="#" id="toggle-btn">立即登录</a>'
      : '没有账号？<a href="#" id="toggle-btn">立即注册</a>';
  });
});

form.action = '/login';

form.addEventListener('submit', async (e) => {
  errorMsg.style.display = 'none';
  const formData = new FormData(form);
  try {
    const res = await fetch(form.action, {
      method: 'POST',
      body: formData,
      redirect: 'manual',
    });
    if (res.type === 'opaqueredirect' || res.status === 302) {
      location.href = res.headers.get('location') || '/me';
    } else if (res.status === 401 || res.status === 400) {
      const text = await res.text();
      errorMsg.textContent = text || '操作失败，请检查输入';
      errorMsg.style.display = 'block';
    } else {
      errorMsg.textContent = '出了点问题，请重试';
      errorMsg.style.display = 'block';
    }
  } catch(e) {
    errorMsg.textContent = '网络错误，请重试';
    errorMsg.style.display = 'block';
  }
  e.preventDefault();
});
</script>
</body>
</html>`;
}
