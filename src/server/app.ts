import { Hono } from "hono";

export function createApp() {
  const app = new Hono();

  app.get("/", (ctx) => {
    return ctx.html(
      `<!DOCTYPE html><html><head><meta charset="utf-8"/><title>公开首页</title></head><body><main><h1>最新发射事件</h1></main></body></html>`
    );
  });

  return app;
}
