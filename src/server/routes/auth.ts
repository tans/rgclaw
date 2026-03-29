import { Hono } from "hono";
import { setCookie } from "hono/cookie";
import { createSession } from "../../db/repositories/sessions";
import { createUser, findUserByEmail } from "../../db/repositories/users";
import type { AppEnv } from "../middleware/session";

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
      const user = await createUser(credentials.email, credentials.password);
      const session = createSession(user.id);

      setCookie(c, "session_id", session.id, {
        httpOnly: true,
        path: "/",
        maxAge: 30 * 24 * 60 * 60,
      });

      return c.redirect("/me", 302);
    } catch {
      return c.text("register failed", 400);
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
    setCookie(c, "session_id", session.id, {
      httpOnly: true,
      path: "/",
      maxAge: 30 * 24 * 60 * 60,
    });

    return c.redirect("/me", 302);
  });

  return app;
}
