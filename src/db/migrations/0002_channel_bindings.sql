create table if not exists channel_bindings (
  id text primary key,
  user_id text not null,
  hub_bot_id text not null,
  hub_channel_id text not null,
  hub_api_key text not null,
  bot_wechat_user_id text,
  last_context_token text,
  status text not null default 'active',
  bound_at text not null,
  hub_outbound_at text,
  hub_keepalive_sent_at text,
  created_at text not null,
  updated_at text not null
);

create unique index if not exists idx_channel_bindings_active_user
  on channel_bindings (user_id)
  where status = 'active';

create unique index if not exists idx_channel_bindings_bot_channel
  on channel_bindings (hub_bot_id, hub_channel_id)
  where status = 'active';

alter table users add column hub_user_id text;
