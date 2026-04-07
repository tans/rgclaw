---
name: fullstack-orchestrator
description: 全栈开发任务编排器。当用户请求实现新功能、开发 API、设计数据库、创建 workers 或 collectors、实现微信机器人集成时，必须使用此技能。通过 Agent 团队协调后端、数据、集成 Agent 协作完成任务。
---

# Fullstack Orchestrator

## 技能职责

全栈开发团队的编排中枢。当用户请求以下类型任务时触发：

- **功能开发** — "实现 XXX 功能"、"添加 XXX API"
- **API 设计** — "创建 REST API"、"设计接口"
- **数据库** — "添加数据表"、"修改 schema"
- **Workers/Collectors** — "实现定时任务"、"添加数据收集器"
- **集成** — "接入微信机器人"、"对接第三方 API"
- **修改/更新** — "修改现有功能"、"更新实现"

## 工作流程

### Phase 0: 上下文确认

检查 `_workspace/` 是否存在：

1. **存在 + 部分修改请求** → 部分重新执行（仅相关 Agent 重新处理）
2. **存在 + 新输入** → 新执行（将 `_workspace/` 移动到 `_workspace_prev/`）
3. **不存在** → 初始执行

### Phase 1: 任务分解

1. 读取用户需求
2. 分析任务类型：
   - 后端 API → 分配给 `backend-dev`
   - 数据处理 → 分配给 `data-eng`
   - 集成 → 分配给 `integration-dev`
3. 确定任务依赖关系
4. 创建 TaskCreate 任务列表

### Phase 2: 任务分配与协调

使用 TeamCreate 创建团队：

```
fullstack-lead (主编排)
├── backend-dev (后端开发)
├── data-eng (数据工程)
└── integration-dev (集成开发)
```

并行任务并行分配，顺序任务设置 blockedBy 依赖。

### Phase 3: 结果汇总

1. 等待所有 Agent 完成
2. 验证产出完整性
3. 汇总到 `_workspace/{phase}_{agent}_{artifact}.{ext}`
4. 向用户呈现最终结果

## Agent 职责矩阵

| 任务类型 | 处理 Agent | 典型产出 |
|---------|-----------|---------|
| API 设计/实现 | backend-dev | `src/server/routes/*.ts` |
| 数据库 schema | backend-dev | `src/db/*.ts` |
| 服务层逻辑 | backend-dev | `src/services/*.ts` |
| Collectors | data-eng | `src/collectors/*.ts` |
| Workers | data-eng | `src/workers/*.ts` |
| 微信机器人 | integration-dev | `src/adapters/*.ts` |
| 外部 API | integration-dev | `src/services/*.ts` |

## 数据传递

- **任务状态：** TaskCreate / TaskUpdate
- **实时沟通：** SendMessage
- **文件传递：** `_workspace/` 目录

## 错误处理

- 单个 Agent 失败：评估是否重新分配或调整方案
- 任务依赖失败：通知用户并请求指示
- 团队通信失败：记录错误并尝试恢复

## 测试场景

### 场景 1: 新功能开发

```
用户: "添加用户登录功能"
1. fullstack-lead 分析需求 → 需要 backend-dev
2. backend-dev 创建 API 路由、数据模型、认证逻辑
3. 验证 TypeScript 编译通过
4. 汇总结果给用户
```

### 场景 2: 多 Agent 协作

```
用户: "实现区块链数据收集并通过微信机器人推送"
1. fullstack-lead 分解任务：
   - data-eng: 创建 BSC collector
   - integration-dev: 微信通知服务
2. 并行执行两个任务
3. 汇总集成
```

### 场景 3: 错误恢复

```
backend-dev 报告: "无法完成数据库迁移"
1. fullstack-lead 评估问题
2. 可能是 schema 冲突或权限问题
3. 重新分配或请求用户介入
```

## 后续支持关键词

- "再次执行"、"重新运行"
- "更新 XXX"、"修改 XXX"
- "基于上次结果改进"
- "只修改 XXX 部分"
