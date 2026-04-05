import { openDb } from "../sqlite";

export type WechatBotBinding = {
  id: string;
  user_id: string;
  bot_token: string;
  bot_id: string;
  account_id: string;
  user_wx_id: string;
  base_url: string;
  status: "active" | "inactive" | "expired";
  bound_at: string;
  last_poll_at: string | null;
  last_message_at: string | null;
  created_at: string;
  updated_at: string;
};

const DB_PATH = process.env.DATABASE_PATH ?? "./data/app.sqlite";

export function findActiveBindingByUserId(userId: string): WechatBotBinding | null {
  const db = openDb(DB_PATH);
  try {
    const binding = db
      .query(`
        SELECT id, user_id, bot_token, bot_id, account_id, user_wx_id, base_url, 
               status, bound_at, last_poll_at, last_message_at, created_at, updated_at
        FROM wechat_bot_bindings 
        WHERE user_id = ? AND status = 'active'
      `)
      .get(userId) as WechatBotBinding | null;
    return binding;
  } finally {
    db.close();
  }
}

export function createBinding(params: {
  id: string;
  user_id: string;
  bot_token: string;
  bot_id: string;
  account_id: string;
  user_wx_id: string;
  base_url?: string;
}): WechatBotBinding {
  const db = openDb(DB_PATH);
  const now = new Date().toISOString();
  try {
    db.query(`
      INSERT OR REPLACE INTO wechat_bot_bindings
        (id, user_id, bot_token, bot_id, account_id, user_wx_id, base_url, status, bound_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?)
    `).run(
      params.id,
      params.user_id,
      params.bot_token,
      params.bot_id,
      params.account_id,
      params.user_wx_id,
      params.base_url ?? "https://ilinkai.weixin.qq.com",
      now,
      now,
      now
    );
    
    return {
      id: params.id,
      user_id: params.user_id,
      bot_token: params.bot_token,
      bot_id: params.bot_id,
      account_id: params.account_id,
      user_wx_id: params.user_wx_id,
      base_url: params.base_url ?? "https://ilinkai.weixin.qq.com",
      status: "active",
      bound_at: now,
      last_poll_at: null,
      last_message_at: null,
      created_at: now,
      updated_at: now,
    };
  } finally {
    db.close();
  }
}

export function deactivateBinding(bindingId: string): void {
  const db = openDb(DB_PATH);
  const now = new Date().toISOString();
  try {
    db.query(`
      UPDATE wechat_bot_bindings 
      SET status = 'inactive', updated_at = ?
      WHERE id = ?
    `).run(now, bindingId);
  } finally {
    db.close();
  }
}

export function updateLastPollTime(bindingId: string): void {
  const db = openDb(DB_PATH);
  const now = new Date().toISOString();
  try {
    db.query(`
      UPDATE wechat_bot_bindings 
      SET last_poll_at = ?, updated_at = ?
      WHERE id = ?
    `).run(now, now, bindingId);
  } finally {
    db.close();
  }
}

export function updateLastMessageTime(bindingId: string): void {
  const db = openDb(DB_PATH);
  const now = new Date().toISOString();
  try {
    db.query(`
      UPDATE wechat_bot_bindings 
      SET last_message_at = ?, updated_at = ?
      WHERE id = ?
    `).run(now, now, bindingId);
  } finally {
    db.close();
  }
}

export function getAllActiveBindings(): WechatBotBinding[] {
  const db = openDb(DB_PATH);
  try {
    const bindings = db
      .query(`
        SELECT id, user_id, bot_token, bot_id, account_id, user_wx_id, base_url, 
               status, bound_at, last_poll_at, last_message_at, created_at, updated_at
        FROM wechat_bot_bindings 
        WHERE status = 'active'
      `)
      .all() as WechatBotBinding[];
    return bindings;
  } finally {
    db.close();
  }
}
