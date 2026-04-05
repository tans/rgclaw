import type { MiddlewareHandler } from "hono";
import { getCookie } from "hono/cookie";
import { findSession } from "../../db/repositories/sessions";

export type AppEnv = {
  Variables: {
    sessionUserId?: string;
  };
};

export const sessionMiddleware: MiddlewareHandler<AppEnv> = async (c, next) => {
  const sessionId = getCookie(c, "session_id");

  if (sessionId) {
    const session = findSession(sessionId);
    if (session) {
      c.set("sessionUserId", session.user_id);
    }
  }

  await next();
};
