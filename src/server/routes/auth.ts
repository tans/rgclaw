import { Hono } from "hono";
import { setCookie, getCookie } from "hono/cookie";
import { openDb } from "../../db/sqlite";
import { createSession } from "../../db/repositories/sessions";
import { upsertUserByWalletAddress, findUserByWallet } from "../../db/repositories/users";
import { ensureTrialEntitlement } from "../../db/repositories/entitlements";
import { renderLoginPage } from "../views/login";
import type { AppEnv } from "../middleware/session";

const SESSION_COOKIE_MAX_AGE = 30 * 24 * 60 * 60;

function sessionCookieOptions() {
  return {
    httpOnly: true,
    path: "/",
    maxAge: SESSION_COOKIE_MAX_AGE,
    sameSite: "Lax" as const,
    secure: process.env.NODE_ENV === "production",
  };
}

// 验证以太坊地址格式
function isValidWalletAddress(address: string): boolean {
  return /^0x[a-fA-F0-9]{40}$/.test(address);
}

export function authRoutes() {
  const app = new Hono<AppEnv>();

  // GET /auth/login — render login page
  app.get("/auth/login", (c) => {
    return c.html(renderLoginPage());
  });

  // POST /login — wallet-based login
  app.post("/login", async (c) => {
    let wallet: string | undefined;
    
    // Try JSON body first
    try {
      const json = await c.req.json();
      wallet = json.wallet;
    } catch {
      // Fall back to form data
      const body = await c.req.parseBody();
      const walletField = body.wallet;
      if (typeof walletField === "string") {
        wallet = walletField;
      }
    }

    if (!wallet || typeof wallet !== "string") {
      return c.text("钱包地址不能为空", 400);
    }

    wallet = wallet.trim().toLowerCase();
    
    if (!isValidWalletAddress(wallet)) {
      return c.text("无效的钱包地址格式", 400);
    }

    // Upsert user by wallet address
    const userId = upsertUserByWalletAddress(wallet);
    ensureTrialEntitlement(userId);
    if (!userId) {
      return c.text("登录失败，请重试", 500);
    }

    // Create session
    const session = createSession(userId);
    setCookie(c, "session_id", session.id, sessionCookieOptions());

    return c.redirect("/me", 302);
  });

  // POST /logout
  app.post("/logout", async (c) => {
    const sessionId = getCookie(c, "session_id");
    if (sessionId) {
      const { findSession, deleteSession } = await import("../../db/repositories/sessions");
      const session = findSession(sessionId);
      if (session) {
        deleteSession(sessionId);
      }
    }
    setCookie(c, "session_id", "", { ...sessionCookieOptions(), maxAge: 0 });
    return c.redirect("/", 302);
  });

  // GET /logout (for simple links)
  app.get("/logout", async (c) => {
    const sessionId = getCookie(c, "session_id");
    if (sessionId) {
      const { findSession, deleteSession } = await import("../../db/repositories/sessions");
      const session = findSession(sessionId);
      if (session) {
        deleteSession(sessionId);
      }
    }
    setCookie(c, "session_id", "", { ...sessionCookieOptions(), maxAge: 0 });
    return c.redirect("/", 302);
  });

  return app;
}
