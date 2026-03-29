import { describe, expect, test } from "bun:test";
import { createApp } from "../../src/server/app";

describe("GET /", () => {
  test("返回公开首页标题", async () => {
    const app = createApp();
    const res = await app.request("/");

    expect(res.status).toBe(200);
    expect(await res.text()).toContain("最新发射事件");
  });
});
