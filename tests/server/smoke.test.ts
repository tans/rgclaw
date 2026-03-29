import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { createApp } from "../../src/server/app";

function setupSmokeTestApp() {
  const dir = mkdtempSync(join(tmpdir(), "rgclaw-smoke-"));
  const dbPath = join(dir, "app.sqlite");
  process.env.DATABASE_PATH = dbPath;

  return {
    app: createApp(),
    cleanup() {
      rmSync(dir, { recursive: true, force: true });
      delete process.env.DATABASE_PATH;
    },
  };
}

describe("smoke regression", () => {
  test("首页、用户中心、续费页路由存在", async () => {
    const { app, cleanup } = setupSmokeTestApp();

    try {
      expect((await app.request("http://localhost/")).status).toBe(200);
      expect(
        (await app.request("http://localhost/me", { redirect: "manual" })).status,
      ).toBe(302);
      expect(
        (await app.request("http://localhost/renew", { redirect: "manual" })).status,
      ).toBe(302);
    } finally {
      cleanup();
    }
  });
});
