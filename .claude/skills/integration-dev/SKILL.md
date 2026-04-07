---
name: integration-dev
description: 集成开发技能。处理微信机器人集成、第三方 API、QRCode 生成。当用户请求实现微信自动回复、接入外部服务、生成二维码时使用。
---

# Integration Developer Skill

## 技术栈

- **Runtime:** Bun
- **WeChat:** @wechatbot/wechatbot
- **QRCode:** qrcode 库
- **HTTP:** Hono client、fetch

## 职责范围

### 1. 微信机器人

- 消息接收和处理
- 自动回复逻辑
- 命令处理
- 群管理

### 2. 外部 API 集成

- API 调用封装
- Webhook 处理
- 认证和授权
- 错误重试

### 3. QRCode 生成

- 二维码创建
- 二维码数据编码
- 图像处理

## 代码模板

### 微信机器人消息处理

```typescript
// src/adapters/wechat/{handler}.ts
import { WeChatBot } from '@wechatbot/wechatbot';

const bot = new WeChatBot({
  token: process.env.WECHAT_TOKEN,
});

bot.on('message', async (msg) => {
  const { type, content, fromUser } = msg;

  switch (type) {
    case 'text':
      await handleTextMessage(content, fromUser);
      break;
    case 'command':
      await handleCommand(content, fromUser);
      break;
    default:
      break;
  }
});

async function handleTextMessage(content: string, fromUser: string) {
  // 处理文本消息
  const reply = `收到: ${content}`;
  await bot.sendMessage(fromUser, reply);
}
```

### QRCode 生成

```typescript
// src/services/qrcode.ts
import QRCode from 'qrcode';

export async function generateQRCode(data: string): Promise<Buffer> {
  return QRCode.toBuffer(data, {
    type: 'png',
    width: 300,
    margin: 2,
  });
}
```

### API 客户端

```typescript
// src/adapters/{service}/client.ts
const BASE_URL = process.env.{SERVICE}_API_URL;

interface ApiResponse {
  data: unknown;
  error?: string;
}

export async function callApi<T>(endpoint: string): Promise<T> {
  const response = await fetch(`${BASE_URL}${endpoint}`, {
    headers: {
      'Authorization': `Bearer ${process.env.{SERVICE}_API_KEY}`,
      'Content-Type': 'application/json',
    },
    signal: AbortSignal.timeout(10000),
  });

  if (!response.ok) {
    throw new Error(`API Error: ${response.status}`);
  }

  return response.json();
}
```

## 关键文件路径

```
src/
├── adapters/
│   └── wechat/        # 微信适配器
│   └── {service}/     # 其他外部服务
├── services/
│   └── qrcode.ts      # QRCode 服务
└── shared/            # 共享工具
```

## 错误处理策略

1. **重试机制** — API 调用失败时指数退避重试
2. **降级方案** — 服务不可用时的 fallback
3. **超时控制** — 所有外部调用设置 timeout
4. **日志审计** — 记录所有外部调用（不含敏感信息）

## 触发场景

- "实现微信自动回复"
- "接入第三方 API"
- "生成二维码"
- "处理 Webhook 回调"
- "添加微信命令"
