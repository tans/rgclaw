---
name: backend-dev
description: Bun + Hono 后端开发技能。处理 API 设计、路由实现、数据库操作、服务层业务逻辑。当用户请求创建 API、实现业务逻辑、操作数据库、设计接口时使用。
---

# Backend Developer Skill

## 技术栈

- **Runtime:** Bun
- **Framework:** Hono (轻量级 Web 框架)
- **Language:** TypeScript
- **Database:** SQLite (通过 `src/db/` 目录)

## 职责范围

### 1. API 设计

- RESTful 接口设计
- 请求/响应类型定义
- 参数验证
- 错误响应格式

### 2. Hono 路由实现

- 路由定义 (`src/server/`)
- 中间件开发
- 上下文处理
- CORS、认证等通用中间件

### 3. 数据库操作

- Schema 定义
- 数据迁移 (`src/db/migrate.ts`)
- CRUD 操作
- 事务处理

### 4. 服务层

- 业务逻辑实现 (`src/services/`)
- 数据转换
- 缓存策略

## 代码模板

### API 路由模板

```typescript
// src/server/routes/{resource}.ts
import { Hono } from 'hono';
import { db } from '../../db';
import type { Variables } from '../index';

const app = new Hono<{ Variables: Variables }>();

// GET /api/{resource}
app.get('/', async (c) => {
  const items = await db.{resource}.findMany();
  return c.json(items);
});

// GET /api/{resource}/:id
app.get('/:id', async (c) => {
  const id = c.req.param('id');
  const item = await db.{resource}.findUnique({ where: { id } });
  if (!item) return c.json({ error: 'Not found' }, 404);
  return c.json(item);
});

// POST /api/{resource}
app.post('/', async (c) => {
  const body = await c.req.json();
  const item = await db.{resource}.create({ data: body });
  return c.json(item, 201);
});

export default app;
```

### 数据库 Schema 模板

```typescript
// src/db/schema.ts
import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';

export const {resource}s = sqliteTable('{resource}s', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
});

export type {Resource} = typeof {resource}s.$inferSelect;
```

## 开发规范

1. **类型安全** — 使用 TypeScript strict 模式
2. **错误处理** — 所有 async 操作使用 try-catch
3. **日志记录** — 使用 `src/shared/logger.ts`
4. **验证** — 使用 Zod 或类似库验证输入

## 关键文件路径

```
src/
├── server/
│   ├── index.ts        # 服务器入口
│   └── routes/         # API 路由
├── db/
│   ├── migrate.ts      # 数据库迁移
│   └── schema.ts       # Schema 定义
├── services/          # 业务逻辑
└── shared/            # 共享工具
```

## 触发场景

- "创建 XXX API"
- "添加新的数据表"
- "实现用户认证"
- "修改现有接口"
- "添加数据验证"
