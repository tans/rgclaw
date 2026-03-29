import { Hono } from "hono";
import { setCookie } from "hono/cookie";
import { openDb } from "../../db/sqlite";
import { createSession } from "../../db/repositories/sessions";
import { createUserWithPasswordHash, findUserByEmail } from "../../db/repositories/users";
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

function parseCredentials(body: Record<string, string | File>) {
  const emailField = body.email;
  const passwordField = body.password;

  if (typeof emailField !== "string" || typeof passwordField !== "string") {
    return null;
  }

  const email = emailField.trim();
  const password = passwordField;

  if (!email || !password) {
    return null;
  }

  return { email, password };
}

export function authRoutes() {
  const app = new Hono<AppEnv>();

  app.post("/register", async (c) => {
    const body = await c.req.parseBody();
    const credentials = parseCredentials(body);

    if (!credentials) {
      return c.text("invalid credentials", 400);
    }

    try {
      const passwordHash = await Bun.password.hash(credentials.password);
      const db = openDb();

      try {
        const registerUser = db.transaction((email: string, hashedPassword: string) => {
          const user = createUserWithPasswordHash(db, email, hashedPassword);
          const session = createSession(user.id, db);

          return { session };
        });

        const { session } = registerUser(credentials.email, passwordHash);
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
    const credentials = parseCredentials(body);

    if (!credentials) {
      return c.text("invalid credentials", 400);
    }

    const user = findUserByEmail(credentials.email);
    if (!user) {
      return c.text("invalid credentials", 401);
    }

    const matched = await Bun.password.verify(credentials.password, user.password_hash);
    if (!matched) {
      return c.text("invalid credentials", 401);
    }

    const session = createSession(user.id);
    setCookie(c, "session_id", session.id, sessionCookieOptions());

    return c.redirect("/me", 302);
  });

  return app;
}
