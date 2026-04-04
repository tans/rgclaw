import { openDb } from "../sqlite";

export type ChannelBinding = {
  id: string;
  user_id: string;
  hub_bot_id: string;
  hub_channel_id: string;
  hub_api_key: string;
  bot_wechat_user_id: string | null;
  last_context_token: string | null;
  status: string;
  bound_at: string;
  hub_outbound_at: string | null;
  hub_keepalive_sent_at: string | null;
  created_at: string;
  updated_at: string;
};

const SELECT_COLUMNS = `
  id, user_id, hub_bot_id, hub_channel_id, hub_api_key,
  bot_wechat_user_id, last_context_token, status,
  bound_at, hub_outbound_at, hub_keepalive_sent_at,
  created_at, updated_at
`;

export function findActiveChannelBindingByUserId(userId: string): ChannelBinding | null {
  const db = openDb();
  try {
    return db
      .query(`select ${SELECT_COLUMNS} from channel_bindings where user_id = ? and status = 'active'`)
      .get(userId) as ChannelBinding | null;
  } finally {
    db.close();
  }
}

export function findActiveChannelBindingByBotAndChannel(
  hubBotId: string,
  hubChannelId: string,
): ChannelBinding | null {
  const db = openDb();
  try {
    return db
      .query(
        `select ${SELECT_COLUMNS} from channel_bindings where hub_bot_id = ? and hub_channel_id = ? and status = 'active'`,
      )
      .get(hubBotId, hubChannelId) as ChannelBinding | null;
  } finally {
    db.close();
  }
}

export function replaceActiveChannelBinding(input: {
  userId: string;
  hubBotId: string;
  hubChannelId: string;
  hubApiKey: string;
  now: string;
}): ChannelBinding {
  const db = openDb();
  try {
    return db.transaction((entry: typeof input) => {
      db.query(
        `update channel_bindings set status = 'inactive', updated_at = ? where status = 'active' and user_id = ?`,
      ).run(entry.now, entry.userId);

      db.query(
        `update channel_bindings set status = 'inactive', updated_at = ? where status = 'active' and hub_bot_id = ? and hub_channel_id = ?`,
      ).run(entry.now, entry.hubBotId, entry.hubChannelId);

      const id = crypto.randomUUID();
      db.query(
        `insert into channel_bindings
           (id, user_id, hub_bot_id, hub_channel_id, hub_api_key, bot_wechat_user_id, last_context_token,
            status, bound_at, hub_outbound_at, hub_keepalive_sent_at, created_at, updated_at)
         values (?, ?, ?, ?, ?, null, null, 'active', ?, null, null, ?, ?)`,
      ).run(id, entry.userId, entry.hubBotId, entry.hubChannelId, entry.hubApiKey, entry.now, entry.now, entry.now);

      return {
        id,
        user_id: entry.userId,
        hub_bot_id: entry.hubBotId,
        hub_channel_id: entry.hubChannelId,
        hub_api_key: entry.hubApiKey,
        bot_wechat_user_id: null,
        last_context_token: null,
        status: "active",
        bound_at: entry.now,
        hub_outbound_at: null,
        hub_keepalive_sent_at: null,
        created_at: entry.now,
        updated_at: entry.now,
      } satisfies ChannelBinding;
    })(input);
  } finally {
    db.close();
  }
}

export function deactivateChannelBinding(bindingId: string, now: string) {
  const db = openDb();
  try {
    db.query(`update channel_bindings set status = 'inactive', updated_at = ? where id = ?`).run(now, bindingId);
  } finally {
    db.close();
  }
}

export function touchChannelBindingInbound(input: {
  hubBotId: string;
  hubChannelId: string;
  botWechatUserId: string;
  contextToken: string;
  receivedAt: string;
}) {
  const db = openDb();
  try {
    db.query(
      `update channel_bindings
         set bot_wechat_user_id = ?, last_context_token = ?, updated_at = ?
         where hub_bot_id = ? and hub_channel_id = ? and status = 'active'`,
    ).run(input.botWechatUserId, input.contextToken, input.receivedAt, input.hubBotId, input.hubChannelId);
  } finally {
    db.close();
  }
}

export function getChannelBindingByUserId(userId: string): ChannelBinding | null {
  const db = openDb();
  try {
    return db
      .query(
        `select ${SELECT_COLUMNS} from channel_bindings where user_id = ?
         order by case when status = 'active' then 0 else 1 end, datetime(updated_at) desc limit 1`,
      )
      .get(userId) as ChannelBinding | null;
  } finally {
    db.close();
  }
}
