# 部署文档

## 服务架构

- **regouapp-web** — 前端服务（PM2 fork 模式）
- **regouapp-collector** — 采集器服务
- **regouapp-worker** — Worker 服务

代码路径：`/root/rgclaw`
日志路径：`/root/rgclaw/logs`

## 服务器信息

- IP：`139.224.105.241`
- SSH Key：`/Users/ke/code/regou-app/ssh/139.224.105.241_20260404233402_id_rsa`
- 用户：`root`

## 部署流程

### 前置准备

1. 在本地打包代码：
   ```bash
   cd /Users/ke/code/regou-app
   tar --exclude='.git' \
       --exclude='node_modules' \
       --exclude='*.log' \
       -czf regou-app.tar.gz .
   ```

2. 上传到服务器：
   ```bash
   scp -i /Users/ke/code/regou-app/ssh/139.224.105.241_20260404233402_id_rsa \
       -o StrictHostKeyChecking=no \
       regou-app.tar.gz \
       root@139.224.105.241:/root/
   ```

### 部署脚本（上传后执行）

```bash
ssh -i /Users/ke/code/regou-app/ssh/139.224.105.241_20260404233402_id_rsa \
    -o StrictHostKeyChecking=no \
    root@139.224.105.241 bash << 'SCRIPT'
set -e

# 1. 备份旧版本
cp -r /root/rgclaw /root/rgclaw_backup_$(date +%Y%m%d_%H%M%S) 2>/dev/null || true

# 2. 解压新代码
rm -rf /root/regou-app_new
mkdir -p /root/regou-app_new
tar xzf /root/regou-app.tar.gz -C /root/regou-app_new --strip-components=1

# 3. 安装依赖
export PATH="$HOME/.bun/bin:$PATH"
cd /root/regou-app_new
bun install 2>&1 | tail -3

# 4. 切换新旧版本（原子操作）
rm -rf /root/rgclaw_old_backup 2>/dev/null
mv /root/rgclaw /root/rgclaw_old_backup 2>/dev/null || true
mv /root/regou-app_new /root/rgclaw

# 5. 重启 PM2
cd /root/rgclaw
pm2 delete regouapp-web regouapp-collector regouapp-worker 2>/dev/null || true
pm2 start ecosystem.config.json
pm2 list
SCRIPT
```

### 事后验证

```bash
# 检查服务状态
ssh -i ... root@139.224.105.241 "pm2 list"

# 检查端口监听
ssh -i ... root@139.224.105.241 "ss -tlnp | grep -E '30082|24056'"

# 检查 nginx 代理是否指向正确端口
ssh -i ... root@139.224.105.241 "openresty -t && openresty -s reload"
```

## 常见问题

### bun install 失败
- 确认服务器上 `bun` 路径：`$HOME/.bun/bin/bun`
- 确认 `$HOME/.bun/bin` 在 PATH 中

### 服务起不来但 PM2 显示 online
- 看日志：`pm2 logs regouapp-web --lines 50`
- 可能是端口被占用或 `.env` 配置问题

### nginx 502
- 确认 upstream 端口与实际服务端口一致
- 新服务端口 `30082`，旧服务端口 `24056`

## 回滚

```bash
# 找到备份目录
ssh -i ... root@139.224.105.241 "ls -t /root/ | grep rgclaw_backup"

# 恢复
ssh -i ... root@139.224.105.241 "\
  rm -rf /root/rgclaw && \
  mv /root/rgclaw_backup_YYYYMMDD_HHMMSS /root/rgclaw && \
  cd /root/rgclaw && pm2 restart all"
```
