import { Hono } from "hono";
import { setCookie, getCookie } from "hono/cookie";
import { openDb } from "../../db/sqlite";
import { createSession } from "../../db/repositories/sessions";
import { upsertUserByHubUserId } from "../../db/repositories/users";
import { hubGetMe } from "../../openilink/client";
import { config } from "../../shared/config";
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

export function authRoutes() {
  const app = new Hono<AppEnv>();

  // -----------------------------------------------------------------
  // Hub OAuth login — redirect to Hub
  // -----------------------------------------------------------------
  app.get("/auth/oauth/github", (c) => {
    const redirectUri = config.openilinkOAuthCallbackUrl;
    const hubUrl = config.openilinkHubUrl;
    const targetUrl = `${hubUrl}/api/auth/oauth/github?redirect=${encodeURIComponent(redirectUri)}`;
    return c.redirect(targetUrl, 302);
  });

  // -----------------------------------------------------------------
  // Hub OAuth callback — exchange code for rgclaw session
  // -----------------------------------------------------------------
  app.get("/auth/callback/github", async (c) => {
    const code = c.req.query("code");
    if (!code) {
      return c.text("missing code", 400);
    }

    let hubUserId: string;
    let hubEmail: string;
    let hubSession: string;

    try {
      // Fetch Hub's session cookie by calling the callback endpoint
      // We need the Hub to set its own session cookie; we extract it via a
      // dedicated internal endpoint so we can map the Hub user to rgclaw.
      const hubBase = config.openilinkHubUrl;
      const callbackUrl = `${hubBase}/api/auth/callback/github`;

      // Use credentials mode to let the Hub set its session cookie in our response
      const hubResp = await fetch(callbackUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
        redirect: "manual",
      });

      // Hub sets a Set-Cookie header with its session; extract it
      const setCookieHeader = hubResp.headers.get("set-cookie") ?? "";
      const hubSessionMatch = setCookieHeader.match(/session=([^;]+)/);
      hubSession = hubSessionMatch?.[1] ?? "";

      if (!hubSession) {
        return c.text("hub session not received", 500);
      }

      // Get Hub user info
      const hubUser = await hubGetMe(hubSession);
      hubUserId = hubUser.id;
      hubEmail = hubUser.email;
    } catch (err) {
      console.error("hub oauth callback failed:", err);
      return c.text("hub oauth failed", 502);
    }

    // Upsert rgclaw user
    const userId = upsertUserByHubUserId(hubUserId, hubEmail);

    // Create local session
    const session = createSession(userId);
    setCookie(c, "session_id", session.id, sessionCookieOptions());

    // Store Hub session cookie so subsequent Hub API calls work
    setCookie(c, "hub_session", hubSession, sessionCookieOptions());

    return c.redirect("/me", 302);
  });

  // -----------------------------------------------------------------
  // Legacy: register/login still work for password-based accounts
  // -----------------------------------------------------------------
  app.post("/register", async (c) => {
    const body = await c.req.parseBody();
    const emailField = body.email;
    const passwordField = body.password;

    if (typeof emailField !== "string" || typeof passwordField !== "string") {
      return c.text("invalid credentials", 400);
    }

    if (!emailField || !passwordField) {
      return c.text("invalid credentials", 400);
    }

    try {
      const passwordHash = await Bun.password.hash(passwordField);
      const db = openDb();

      try {
        const { createUserWithPasswordHash } = await import("../../db/repositories/users");
        const user = createUserWithPasswordHash(db, emailField.trim(), passwordHash);
        const session = createSession(user.id, db);
        setCookie(c, "session_id", session.id, sessionCookieOptions());
      } finally {
        db.close();
      }

      return c.redirect("/me", 302);
    } catch {
      return c.text("register failed", 500);
    }
  });

  app.post("/login", async (c) => {
    const body = await c.req.parseBody();
    const emailField = body.email;
    const passwordField = body.password;

    if (typeof emailField !== "string" || typeof passwordField !== "string") {
      return c.text("invalid credentials", 400);
    }

    if (!emailField || !passwordField) {
      return c.text("invalid credentials", 400);
    }

    const { findUserByEmail } = await import("../../db/repositories/users");
    const user = findUserByEmail(emailField.trim());
    if (!user) {
      return c.text("invalid credentials", 401);
    }

    // Hub-OAuth users have no password
    if (!user.password_hash) {
      return c.text("invalid credentials", 401);
    }

    const matched = await Bun.password.verify(passwordField, user.password_hash);
    if (!matched) {
      return c.text("invalid credentials", 401);
    }

    const session = createSession(user.id);
    setCookie(c, "session_id", session.id, sessionCookieOptions());

    return c.redirect("/me", 302);
  });

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

  return app;
}
