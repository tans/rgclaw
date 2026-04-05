# regou.app 部署文档

## 服务架构

| 服务 | 入口 | 说明 |
|------|------|------|
| regouapp-web | `src/server/index.ts` | 主服务（HTTP API + 前端） |
| regouapp-collector | `src/collectors/run.ts` | 区块链数据采集器 |
| regouapp-worker | `src/workers/run.ts` | 后台任务 Worker |

- **部署方式**：1Panel 站点 + PM2 进程管理
- **域名**：`regou.app`
- **后端端口**：`30082`（ ecosystem.config.json 中定义）
- **1Panel 管理面板**：`http://regou.app:8090`

## 服务器信息

```
IP：139.224.105.241
SSH Key：./ssh/139.224.105.241_20260404233402_id_rsa
用户：root
代码路径：/root/regou-app
```

## 1Panel 配置（参考）

1Panel 中已存在站点 `regou.app`，类型为 **反向代理（TCP）**，指向 `127.0.0.1:30082`。

如需通过 API 操作 1Panel：

```bash
# 1Panel API Base
ONEPANEL_BASE_URL="http://regou.app:8090"
ONEPANEL_API_KEY="hz7Atr0BqUgvB0Af8UkbB41ysreWDeNz"
```

## 一键部署

### 本地执行（推荐）

```bash
cd ~/code/regou-app
./scripts/deploy.sh
```

脚本会自动完成：
1. 打包代码（排除 `.git`、`node_modules`、`data`、`logs`）
2. 上传到服务器 `/root/regou-app.tar.gz`
3. 备份旧版本到 `/root/regou-app_backup_YYYYMMDD_HHMMSS`
4. 解压并执行 `bun install`
5. 重启 PM2（`regouapp-web`、`regouapp-collector`、`regouapp-worker`）
6. 验证 `https://regou.app` HTTP 状态

### 手动分步部署

**Step 1：打包**

```bash
cd ~/code/regou-app
tar czf /tmp/regouapp-deploy.tar.gz \
    --exclude='.git' \
    --exclude='node_modules' \
    --exclude='data/*.sqlite*' \
    --exclude='logs' \
    --exclude='.DS_Store' \
    .
```

**Step 2：上传**

```bash
scp -i ./ssh/139.224.105.241_20260404233402_id_rsa \
    -o StrictHostKeyChecking=no \
    /tmp/regouapp-deploy.tar.gz \
    root@139.224.105.241:/root/regou-app.tar.gz
```

**Step 3：远程部署**

```bash
ssh -i ./ssh/139.224.105.241_20260404233402_id_rsa \
    -o StrictHostKeyChecking=no \
    root@139.224.105.241 bash << 'SCRIPT'
set -e

# 备份
cp -r /root/regou-app /root/regou-app_backup_$(date +%Y%m%d_%H%M%S) 2>/dev/null || true

# 解压覆盖
tar xzf /root/regou-app.tar.gz -C /root/regou-app --overwrite

# 安装依赖
export PATH="$HOME/.bun/bin:$PATH"
cd /root/regou-app
bun install 2>&1 | tail -3

# 重启 PM2
pm2 delete regouapp-web regouapp-collector regouapp-worker 2>/dev/null || true
pm2 start ecosystem.config.json
pm2 list
SCRIPT
```

## 1Panel 站点管理（可选）

如需通过 API 更新反向代理指向的端口：

```bash
./scripts/deploy-with-1panel.ts regou.app 30082 regou
```

参数说明：
1. 域名
2. 后端服务端口
3. 应用名称标识

## PM2 服务管理

```bash
# 查看状态
ssh -i ./ssh/... root@139.224.105.241 "pm2 list"

# 重启单个服务
ssh -i ./ssh/... root@139.224.105.241 "pm2 restart regouapp-web"

# 重启全部
ssh -i ./ssh/... root@139.224.105.241 "pm2 restart all"

# 查看日志
ssh -i ./ssh/... root@139.224.105.241 "pm2 logs regouapp-web --lines 50"

# 或用 ops 脚本
bash scripts/ops/status.sh
bash scripts/ops/logs.sh
```

## 验证

```bash
# HTTP 状态检查
curl -s -o /dev/null -w "%{http_code}" https://regou.app/

# 检查端口监听
ssh -i ./ssh/... root@139.224.105.241 "ss -tlnp | grep 30082"

# 检查 1Panel OpenResty
ssh -i ./ssh/... root@139.224.105.241 "openresty -t"
```

## 回滚

```bash
# 找到备份
ssh -i ./ssh/... root@139.224.105.241 "ls -t /root/ | grep regou-app_backup"

# 恢复
ssh -i ./ssh/... root@139.224.105.241 bash << 'SCRIPT'
BACKUP=$(ls -t /root/ | grep 'regou-app_backup_' | head -1)
if [ -n "$BACKUP" ]; then
    rm -rf /root/regou-app
    cp -r "/root/$BACKUP" /root/regou-app
    cd /root/regou-app && pm2 restart all
    echo "Rolled back to: $BACKUP"
else
    echo "No backup found"
fi
SCRIPT
```

## 目录结构（服务器）

```
/root/
├── rgclaw/                    # 当前运行版本
├── rgclaw_backup_YYYYMMDD/    # 旧版本备份
└── regou-app.tar.gz          # 待部署包
```

## 环境变量

服务启动时从 `ecosystem.config.json` 读取，重要变量：

| 变量 | 值 | 说明 |
|------|-----|------|
| `PORT` | `30082` | web 服务端口 |
| `BSC_RPC_URL` | `https://public-bsc.nownodes.io/` | BSC RPC |
| `DATABASE_PATH` | `./data/app.sqlite` | SQLite 数据库路径 |
| `OPENILINK_HUB_URL` | `https://hub.openilink.com` | OpenILink Hub |
| `OPENILINK_OAUTH_CALLBACK_URL` | `https://regou.app/auth/callback` | OAuth 回调 |

如需修改端口，同步修改 `ecosystem.config.json` 中的 `PORT` 和 1Panel 反向代理端口。
