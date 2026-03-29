import { openDb } from "../sqlite";

export type WechatBindingRecord = {
  bind_status: string;
  bind_code: string;
  wechat_user_id: string | null;
};

export function ensureBindCode(userId: string) {
  const db = openDb();

  try {
    const existing = db
      .query("select bind_code, bind_status from user_wechat_bindings where user_id = ?")
      .get(userId) as { bind_code: string; bind_status: string } | null;

    if (existing) {
      return existing;
    }

    const bindCode = `BIND-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;

    db.query("insert into user_wechat_bindings (id, user_id, bind_status, bind_code) values (?, ?, ?, ?)").run(
      crypto.randomUUID(),
      userId,
      "pending",
      bindCode,
    );

    return {
      bind_code: bindCode,
      bind_status: "pending",
    };
  } finally {
    db.close();
  }
}

export function completeBinding(bindCode: string, wechatUserId: string) {
  const db = openDb();

  try {
    const binding = db
      .query("select user_id from user_wechat_bindings where bind_code = ?")
      .get(bindCode) as { user_id: string } | null;

    if (!binding) {
      return null;
    }

    db.query(
      "update user_wechat_bindings set bind_status = ?, wechat_user_id = ?, bound_at = ? where bind_code = ?",
    ).run("bound", wechatUserId, new Date().toISOString(), bindCode);

    return binding;
  } finally {
    db.close();
  }
}

export function getBindingByUserId(userId: string) {
  const db = openDb();

  try {
    return db
      .query("select bind_status, bind_code, wechat_user_id from user_wechat_bindings where user_id = ?")
      .get(userId) as WechatBindingRecord | null;
  } finally {
    db.close();
  }
}
