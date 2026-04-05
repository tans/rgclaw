import type { LaunchEventFeedItem } from "../../db/repositories/launch-events";

function renderEventList(events: LaunchEventFeedItem[]) {
  if (events.length === 0) {
    return "<p style=\"color:#888;text-align:center;padding:40px 0;\">暂无事件</p>";
  }

  const items = events.slice(0, 10).map((event) => {
    const time = new Date(event.event_time).toLocaleString("zh-CN", {
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
    return `<div class="event-item">
      <div class="event-title">${event.title}</div>
      <div class="event-meta">
        <span class="event-source">${event.source === "four" ? "Four" : event.source === "flap" ? "Flap" : event.source}</span>
        <span class="event-time">${time}</span>
      </div>
      <div class="event-address">${event.token_address}</div>
    </div>`;
  });

  return `<div class="events">${items.join("")}</div>`;
}

export function renderHomePage(events: LaunchEventFeedItem[]) {
  return `<!DOCTYPE html>
<html lang="zh">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>RgClaw — Meme 发射通知</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #0a0a0f; color: #fff; min-height: 100vh; }
  .container { max-width: 720px; margin: 0 auto; padding: 0 20px; }
  nav { display: flex; justify-content: space-between; align-items: center; padding: 20px 0; }
  .logo { font-size: 18px; font-weight: 700; letter-spacing: -0.5px; }
  .logo span { color: rgb(7, 193, 96); }
  .nav-links a { color: #888; text-decoration: none; font-size: 14px; margin-left: 24px; transition: color 0.2s; }
  .nav-links a:hover { color: #fff; }
  .hero { padding: 80px 0 60px; text-align: center; }
  .hero h1 { font-size: 40px; font-weight: 800; line-height: 1.15; margin-bottom: 16px; letter-spacing: -1px; }
  .hero h1 em { font-style: normal; color: rgb(7, 193, 96); }
  .hero p { font-size: 17px; color: #888; max-width: 480px; margin: 0 auto 32px; line-height: 1.6; }
  .cta-row { display: flex; gap: 12px; justify-content: center; flex-wrap: wrap; }
  .btn-primary { background: rgb(7, 193, 96); color: #fff; border: none; border-radius: 10px; padding: 14px 32px; font-size: 15px; font-weight: 600; cursor: pointer; text-decoration: none; display: inline-block; transition: background 0.2s, transform 0.1s; }
  .btn-primary:hover { background: rgb(6, 174, 86); transform: translateY(-1px); }
  .btn-secondary { background: rgba(255,255,255,0.06); color: #ccc; border: 1px solid rgba(255,255,255,0.1); border-radius: 10px; padding: 14px 32px; font-size: 15px; font-weight: 600; cursor: pointer; text-decoration: none; display: inline-block; transition: background 0.2s; }
  .btn-secondary:hover { background: rgba(255,255,255,0.1); }
  .features { padding: 60px 0; display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 16px; }
  .feature { background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.07); border-radius: 12px; padding: 24px; }
  .feature-icon { font-size: 28px; margin-bottom: 12px; }
  .feature h3 { font-size: 15px; font-weight: 600; margin-bottom: 6px; }
  .feature p { font-size: 13px; color: #666; line-height: 1.5; }
  .section-title { font-size: 13px; color: #666; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 20px; padding-top: 20px; border-top: 1px solid rgba(255,255,255,0.06); }
  .events { display: flex; flex-direction: column; gap: 8px; padding-bottom: 80px; }
  .event-item { background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.07); border-radius: 10px; padding: 14px 16px; transition: border-color 0.2s; }
  .event-item:hover { border-color: rgba(255,255,255,0.15); }
  .event-title { font-size: 14px; font-weight: 600; margin-bottom: 6px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .event-meta { display: flex; gap: 12px; font-size: 12px; color: #555; margin-bottom: 4px; }
  .event-source { background: rgba(7, 193, 96, 0.15); color: rgb(7, 193, 96); padding: 1px 6px; border-radius: 4px; }
  .event-address { font-size: 11px; color: #444; font-family: monospace; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .pricing { padding: 60px 0; border-top: 1px solid rgba(255,255,255,0.06); }
  .pricing-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 16px; }
  .plan { background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.07); border-radius: 12px; padding: 24px; }
  .plan.popular { border-color: rgb(7, 193, 96); background: rgba(7, 193, 96, 0.08); }
  .plan-name { font-size: 14px; font-weight: 600; margin-bottom: 8px; color: #aaa; }
  .plan-price { font-size: 28px; font-weight: 800; margin-bottom: 4px; }
  .plan-price span { font-size: 14px; font-weight: 400; color: #666; }
  .plan-desc { font-size: 12px; color: #555; margin-bottom: 16px; }
  .plan .btn-primary { display: block; text-align: center; width: 100%; padding: 10px; font-size: 14px; }
  footer { text-align: center; padding: 40px 0; color: #444; font-size: 12px; border-top: 1px solid rgba(255,255,255,0.04); }
</style>
</head>
<body>
<div class="container">
  <nav>
    <div class="logo">Rg<span>Claw</span></div>
    <div class="nav-links">
      <a href="/auth/login">登录</a>
      <a href="/me">控制台</a>
    </div>
  </nav>

  <section class="hero">
    <h1>Meme 代币发射<br/><em>第一时间通知</em></h1>
    <p>连接微信，订阅 Four 和 Flap 的发射事件推送。新用户免费试用 3 天，之后按月或按年订阅。</p>
    <div class="cta-row">
      <a href="/auth/login" class="btn-primary">免费试用 3 天</a>
      <a href="/#pricing" class="btn-secondary">了解定价</a>
    </div>
  </section>

  <section class="features">
    <div class="feature">
      <div class="feature-icon">⚡</div>
      <h3>实时推送</h3>
      <p>Four / Flap 事件触发后，自动推送到你的微信，第一时间获取机会。</p>
    </div>
    <div class="feature">
      <div class="feature-icon">🔒</div>
      <h3>微信直达</h3>
      <p>无需打开 App，通知直接出现在你的微信对话框，漏接率降到最低。</p>
    </div>
    <div class="feature">
      <div class="feature-icon">💳</div>
      <h3>灵活订阅</h3>
      <p>3 天免费试用，之后按月或按年付费，BNB 链上付款，即时生效。</p>
    </div>
  </section>

  <section id="pricing" class="pricing">
    <div class="section-title">订阅方案</div>
    <div class="pricing-grid">
      <div class="plan">
        <div class="plan-name">月付</div>
        <div class="plan-price">0.005 <span>BNB/月</span></div>
        <div class="plan-desc">适合短期使用，自动续费</div>
        <a href="/auth/login" class="btn-primary">开始试用</a>
      </div>
      <div class="plan popular">
        <div class="plan-name">年付 · 推荐</div>
        <div class="plan-price">0.045 <span>BNB/年</span></div>
        <div class="plan-desc">相当于每月 0.00375 BNB，省 25%</div>
        <a href="/auth/login" class="btn-primary">开始试用</a>
      </div>
    </div>
  </section>

  <section>
    <div class="section-title">最近发射事件</div>
    ${renderEventList(events)}
  </section>
</div>

<footer>
  RgClaw · 专注于 Meme 发射通知
</footer>
</body>
</html>`;
}
