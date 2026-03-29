import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { openDb } from "../../src/db/sqlite";
import { createApp } from "../../src/server/app";

function setupTestApp(prefix: string) {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  const dbPath = join(dir, "app.sqlite");
  process.env.DATABASE_PATH = dbPath;

  return {
    app: createApp(),
    dbPath,
    cleanup() {
      rmSync(dir, { recursive: true, force: true });
      delete process.env.DATABASE_PATH;
      delete process.env.NODE_ENV;
    },
  };
}

describe("auth routes", () => {
  test("POST /register 成功后重定向到 /me", async () => {
    const { app, cleanup } = setupTestApp("rgclaw-auth-register-");

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
      cleanup();
    }
  });

  test("POST /login 成功后返回 302 且 set-cookie 包含 session_id", async () => {
    const { app, cleanup } = setupTestApp("rgclaw-auth-login-");

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
      cleanup();
    }
  });

  test("GET /me 未登录时重定向到 /", async () => {
    const { app, cleanup } = setupTestApp("rgclaw-auth-me-anon-");

    try {
      const res = await app.request("http://localhost/me", {
        redirect: "manual",
      });

      expect(res.status).toBe(302);
      expect(res.headers.get("location")).toBe("/");
    } finally {
      cleanup();
    }
  });

  test("POST /login 凭证错误时返回 401", async () => {
    const { app, cleanup } = setupTestApp("rgclaw-auth-login-invalid-");

    try {
      await app.request("http://localhost/register", {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          email: "login-invalid@example.com",
          password: "passw0rd",
        }).toString(),
      });

      const res = await app.request("http://localhost/login", {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          email: "login-invalid@example.com",
          password: "wrong-password",
        }).toString(),
      });

      expect(res.status).toBe(401);
    } finally {
      cleanup();
    }
  });

  test("GET /me 使用伪造的 session_id 时重定向到 /", async () => {
    const { app, cleanup } = setupTestApp("rgclaw-auth-forged-session-");

    try {
      const res = await app.request("http://localhost/me", {
        headers: {
          cookie: "session_id=fake-session-id",
        },
        redirect: "manual",
      });

      expect(res.status).toBe(302);
      expect(res.headers.get("location")).toBe("/");
    } finally {
      cleanup();
    }
  });

  test("GET /me 使用过期的 session_id 时重定向到 /", async () => {
    const { app, dbPath, cleanup } = setupTestApp("rgclaw-auth-expired-session-");
    const db = openDb(dbPath);

    try {
      db.query(
        "insert into users (id, email, password_hash, created_at, updated_at) values (?, ?, ?, ?, ?)",
      ).run(
        "user-expired",
        "expired@example.com",
        "hashed-password",
        "2026-03-29T00:00:00.000Z",
        "2026-03-29T00:00:00.000Z",
      );
      db.query(
        "insert into sessions (id, user_id, expires_at, created_at) values (?, ?, ?, ?)",
      ).run(
        "expired-session",
        "user-expired",
        "2020-01-01T00:00:00.000Z",
        "2026-03-29T00:00:00.000Z",
      );

      const res = await app.request("http://localhost/me", {
        headers: {
          cookie: "session_id=expired-session",
        },
        redirect: "manual",
      });

      expect(res.status).toBe(302);
      expect(res.headers.get("location")).toBe("/");
    } finally {
      db.close();
      cleanup();
    }
  });

  test("session cookie 包含 SameSite 与开发环境默认安全属性", async () => {
    const { app, cleanup } = setupTestApp("rgclaw-auth-cookie-dev-");

    try {
      const res = await app.request("http://localhost/register", {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          email: "cookie-dev@example.com",
          password: "passw0rd",
        }).toString(),
        redirect: "manual",
      });

      const setCookie = res.headers.get("set-cookie");

      expect(setCookie).toContain("session_id=");
      expect(setCookie).toContain("HttpOnly");
      expect(setCookie).toContain("Max-Age=2592000");
      expect(setCookie).toContain("Path=/");
      expect(setCookie).toContain("SameSite=Lax");
      expect(setCookie).not.toContain("Secure");
    } finally {
      cleanup();
    }
  });

  test("production 环境的 session cookie 包含 Secure", async () => {
    process.env.NODE_ENV = "production";
    const { app, cleanup } = setupTestApp("rgclaw-auth-cookie-prod-");

    try {
      const res = await app.request("http://localhost/register", {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          email: "cookie-prod@example.com",
          password: "passw0rd",
        }).toString(),
        redirect: "manual",
      });

      const setCookie = res.headers.get("set-cookie");

      expect(setCookie).toContain("Secure");
      expect(setCookie).toContain("SameSite=Lax");
    } finally {
      cleanup();
    }
  });

  test("POST /register 在 session 创建失败时不会留下半成功用户", async () => {
    const { app, dbPath, cleanup } = setupTestApp("rgclaw-auth-register-atomic-");
    const db = openDb(dbPath);

    try {
      db.exec(`
        create trigger fail_session_insert
        before insert on sessions
        begin
          select raise(fail, 'session insert failed');
        end;
      `);

      const res = await app.request("http://localhost/register", {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          email: "atomic@example.com",
          password: "passw0rd",
        }).toString(),
      });

      const user = db
        .query("select id, email from users where email = ?")
        .get("atomic@example.com") as { id: string; email: string } | null;

      expect(res.status).toBe(500);
      expect(user).toBeNull();
    } finally {
      db.close();
      cleanup();
    }
  });
});
