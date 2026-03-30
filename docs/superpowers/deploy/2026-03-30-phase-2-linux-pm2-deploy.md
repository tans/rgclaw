# 2026-03-30 Linux + Nginx + pm2 部署说明

## 前置要求

- Linux 服务器已安装 Bun
- `pm2` 已安装并可在 `PATH` 中使用
- `curl` 已安装，可用于执行健康检查
- Nginx 已安装并完成基础配置
- 代码已部署到目标目录

## 首次部署

1. 进入目标目录。
2. 复制环境变量模板：

```bash
cp .env.example .env
```

3. 按服务器实际值编辑 `.env`。
4. 执行首发启动：

```bash
bash scripts/ops/bootstrap.sh
```

如果需要手动启动，直接执行：

```bash
mkdir -p logs
pm2 start ecosystem.config.json
pm2 save
```

5. 配置开机自启。
先执行：

```bash
pm2 startup
```

按终端提示复制带 `sudo` 的命令执行完成后，再执行：

```bash
pm2 save
```

6. 查看进程状态：

```bash
bash scripts/ops/status.sh
```

常用 namespace 操作：

```bash
pm2 restart rgclaw
pm2 logs rgclaw
bash scripts/ops/logs.sh
```

7. 执行健康检查：

```bash
bash scripts/ops/healthcheck.sh
```

## 日常更新

```bash
git pull
bun install
bash scripts/ops/restart.sh
pm2 save
bash scripts/ops/healthcheck.sh
```

## 回滚

```bash
git checkout <commit>
bun install
bash scripts/ops/restart.sh
pm2 save
bash scripts/ops/healthcheck.sh
```

## Nginx 参考片段

将 `location /` 反向代理到本机 `3000` 端口：
如果 `.env` 中把 `PORT` 改成了其他值，需要同步修改下面的 `proxy_pass` 端口。

```nginx
location / {
  proxy_pass http://127.0.0.1:3000;
  proxy_set_header Host $host;
  proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
  proxy_set_header X-Forwarded-Proto $scheme;
  proxy_read_timeout 60s;
}
```

## 日志与排障

- `pm2 status`
- `pm2 restart rgclaw`
- `pm2 logs rgclaw`
- `bash scripts/ops/logs.sh`
- `pm2 monit`
- `ls -lah logs/`
- `tail -n 100 logs/rgclaw-web.out.log`
- `tail -n 100 logs/rgclaw-worker.out.log`

## 健康检查边界

`bash scripts/ops/healthcheck.sh` 只校验三件事：

- `pm2` 中 3 个 app 处于 `online`
- 首页 `/` 返回 `200`
- 未登录访问 `/renew` 返回 `302`

它不会验证 `collector` 和 `worker` 最近一轮业务处理是否成功。
如果需要确认链上拉取、数据库写入或后台任务执行结果，请结合 `pm2 logs rgclaw` 和 `logs/` 目录一起排查。
