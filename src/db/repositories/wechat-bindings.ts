import { openDb } from "../sqlite";

export type ActiveWechatBinding = {
  id: string;
  user_id: string;
  bot_id: string;
  bot_wechat_user_id: string;
  status: string;
  bound_at: string | null;
  unbound_at: string | null;
  last_inbound_at: string | null;
  last_outbound_at: string | null;
  last_keepalive_sent_at: string | null;
  last_context_token: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
};

export type WechatBindingRecord = ActiveWechatBinding;

const activeWechatBindingSelect = `
  select
    id,
    user_id,
    bot_id,
    bot_wechat_user_id,
    status,
    bound_at,
    unbound_at,
    last_inbound_at,
    last_outbound_at,
    last_keepalive_sent_at,
    last_context_token,
    last_error,
    created_at,
    updated_at
  from user_wechat_bindings
`;

export function findActiveBindingByUserId(userId: string) {
  const db = openDb();

  try {
    return db
      .query(`${activeWechatBindingSelect} where user_id = ? and status = 'active'`)
      .get(userId) as ActiveWechatBinding | null;
  } finally {
    db.close();
  }
}

export function findActiveBindingByConversation(botId: string, botWechatUserId: string) {
  const db = openDb();

  try {
    return db
      .query(
        `${activeWechatBindingSelect} where bot_id = ? and bot_wechat_user_id = ? and status = 'active'`,
      )
      .get(botId, botWechatUserId) as ActiveWechatBinding | null;
  } finally {
    db.close();
  }
}

export function replaceActiveWechatBinding(input: {
  userId: string;
  botId: string;
  botWechatUserId: string;
  contextToken: string;
  now: string;
}) {
  const db = openDb();

  try {
    db.transaction((entry: typeof input) => {
      db.query(
        "update user_wechat_bindings set status = 'inactive', unbound_at = ?, updated_at = ? where status = 'active' and user_id = ?",
      ).run(entry.now, entry.now, entry.userId);
      db.query(
        "update user_wechat_bindings set status = 'inactive', unbound_at = ?, updated_at = ? where status = 'active' and bot_id = ? and bot_wechat_user_id = ?",
      ).run(entry.now, entry.now, entry.botId, entry.botWechatUserId);
      db.query(
        `
          insert into user_wechat_bindings (
            id,
            user_id,
            bot_id,
            bot_wechat_user_id,
            status,
            bound_at,
            unbound_at,
            last_inbound_at,
            last_outbound_at,
            last_keepalive_sent_at,
            last_context_token,
            last_error,
            created_at,
            updated_at
          ) values (?, ?, ?, ?, 'active', ?, null, ?, null, null, ?, null, ?, ?)
        `,
      ).run(
        crypto.randomUUID(),
        entry.userId,
        entry.botId,
        entry.botWechatUserId,
        entry.now,
        entry.now,
        entry.contextToken || null,
        entry.now,
        entry.now,
      );
    })(input);
  } finally {
    db.close();
  }
}

export function touchActiveBindingInbound(input: {
  botId: string;
  botWechatUserId: string;
  contextToken: string;
  receivedAt: string;
}) {
  const db = openDb();

  try {
    return db
      .query(
        "update user_wechat_bindings set last_inbound_at = ?, last_context_token = ?, updated_at = ? where bot_id = ? and bot_wechat_user_id = ? and status = 'active'",
      )
      .run(
        input.receivedAt,
        input.contextToken || null,
        input.receivedAt,
        input.botId,
        input.botWechatUserId,
      );
  } finally {
    db.close();
  }
}

export function getBindingByUserId(userId: string) {
  const db = openDb();

  try {
    return db
      .query(
        `
          ${activeWechatBindingSelect}
          where user_id = ?
          order by
            case when status = 'active' then 0 else 1 end,
            datetime(updated_at) desc,
            datetime(created_at) desc
          limit 1
        `,
      )
      .get(userId) as WechatBindingRecord | null;
  } finally {
    db.close();
  }
}
