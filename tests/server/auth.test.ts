import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { createApp } from "../../src/server/app";

describe("auth routes", () => {
  test("POST /register 成功后重定向到 /me", async () => {
    const dir = mkdtempSync(join(tmpdir(), "rgclaw-auth-register-"));
    const dbPath = join(dir, "app.sqlite");
    process.env.DATABASE_PATH = dbPath;
    const app = createApp();

    try {
      const res = await app.request("http://localhost/register", {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          email: "register@example.com",
          password: "passw0rd",
        }).toString(),
        redirect: "manual",
      });

      expect(res.status).toBe(302);
      expect(res.headers.get("location")).toBe("/me");
    } finally {
      rmSync(dir, { recursive: true, force: true });
      delete process.env.DATABASE_PATH;
    }
  });

  test("POST /login 成功后返回 302 且 set-cookie 包含 session_id", async () => {
    const dir = mkdtempSync(join(tmpdir(), "rgclaw-auth-login-"));
    const dbPath = join(dir, "app.sqlite");
    process.env.DATABASE_PATH = dbPath;
    const app = createApp();

    try {
      await app.request("http://localhost/register", {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          email: "login@example.com",
          password: "passw0rd",
        }).toString(),
      });

      const res = await app.request("http://localhost/login", {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          email: "login@example.com",
          password: "passw0rd",
        }).toString(),
        redirect: "manual",
      });

      expect(res.status).toBe(302);
      expect(res.headers.get("set-cookie")).toContain("session_id=");
    } finally {
      rmSync(dir, { recursive: true, force: true });
      delete process.env.DATABASE_PATH;
    }
  });
});
