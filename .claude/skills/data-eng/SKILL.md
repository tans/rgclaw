---
name: data-eng
description: 数据工程技能。处理区块链数据收集器、后台 workers、链上数据处理。当用户请求实现数据采集、定时任务、worker 进程、BSC 数据处理时使用。
---

# Data Engineer Skill

## 技术栈

- **Runtime:** Bun
- **Blockchain:** BSC (Binance Smart Chain)
- **Data Processing:** Collectors, Workers

## 职责范围

### 1. 数据收集器 (Collectors)

- BSC 区块链事件监听
- 合约数据抓取
- RPC 调用优化
- 事件签名管理

### 2. 后台 Workers

- 定时任务实现
- 队列处理
- 批处理任务
- 调度管理

### 3. 数据处理

- 数据清洗和转换
- 链上数据分析
- 数据存储优化

## 代码模板

### Collector 模板

```typescript
// src/collectors/{name}.ts
import { ethers } from 'ethers';
import { db } from '../db';

const BSC_RPC = process.env.BSC_RPC_URL!;
const CONTRACT_ADDRESS = process.env.CONTRACT_ADDRESS!;

export async function collect{Resource}() {
  const provider = new ethers.JsonRpcProvider(BSC_RPC);
  const contract = new ethers.Contract(CONTRACT_ADDRESS, ABI, provider);

  // 监听事件
  contract.on('EventName', async (arg1, arg2, event) => {
    await db.insert(events).values({
      blockNumber: event.blockNumber,
      transactionHash: event.transactionHash,
      // ... 其他字段
    });
  });
}
```

### Worker 模板

```typescript
// src/workers/{name}.ts
import { db } from '../db';

export async function process{Task}() {
  const pending = await db.tasks.findMany({
    where: { status: 'pending' },
    take: 100,
  });

  for (const task of pending) {
    try {
      await db.tasks.update({
        where: { id: task.id },
        data: { status: 'processing' },
      });

      // 处理逻辑
      await doProcess(task);

      await db.tasks.update({
        where: { id: task.id },
        data: { status: 'completed' },
      });
    } catch (error) {
      await db.tasks.update({
        where: { id: task.id },
        data: { status: 'failed', error: String(error) },
      });
    }
  }
}
```

## BSC RPC 注意事项

1. **限流处理** — BSC RPC 有 rate limit，实现退避策略
2. **重试机制** — RPC 调用失败时自动重试
3. **事件签名** — 合约事件签名发生变化需更新 (`b9e7fe7` commit 相关)
4. **背fill** — 启动时跳过背fill 避免 RPC crash (`0892b15` commit 相关)

## 关键文件路径

```
src/
├── collectors/
│   ├── run.ts          # Collector 入口
│   └── {name}.ts       # 具体收集器
└── workers/
    ├── run.ts          # Worker 入口
    └── {name}.ts       # 具体 worker
```

## 触发场景

- "实现 BSC 数据收集"
- "添加定时任务"
- "创建 worker 处理"
- "监听合约事件"
- "处理链上数据"
