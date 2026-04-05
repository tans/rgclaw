-- 完整的初始数据库结构
-- 支持钱包登录，email 可选

create table if not exists users (
  id text primary key,
  email text,
  password_hash text,
  hub_user_id text,
  wallet_address text unique,
  wallet_address_updated_at text,
  created_at text not null,
  updated_at text not null
);

create table if not exists sessions (
  id text primary key,
  user_id text not null,
  expires_at text not null,
  created_at text not null
);

create table if not exists user_wechat_bindings (
  id text primary key,
  user_id text not null,
  bot_id text not null,
  bot_wechat_user_id text not null,
  status text not null,
  bound_at text,
  unbound_at text,
  last_inbound_at text,
  last_outbound_at text,
  last_keepalive_sent_at text,
  last_context_token text,
  last_error text,
  created_at text not null,
  updated_at text not null
);

create unique index if not exists idx_user_wechat_bindings_active_user on user_wechat_bindings (user_id) where status = 'active';
create unique index if not exists idx_user_wechat_bindings_active_conversation on user_wechat_bindings (bot_id, bot_wechat_user_id) where status = 'active';

create table if not exists wechat_inbound_events (
  id text primary key,
  message_id text not null unique,
  bot_id text not null,
  from_user_id text not null,
  text text not null,
  received_at text not null,
  process_status text not null,
  raw_payload text not null,
  created_at text not null
);

create table if not exists launch_events (
  id text primary key,
  source text not null,
  source_event_id text not null,
  token_address text not null,
  symbol text,
  title text not null,
  event_time text not null,
  chain text not null,
  raw_payload text not null,
  dedupe_key text not null unique,
  created_at text not null
);

create table if not exists user_source_subscriptions (
  id text primary key,
  user_id text not null,
  source text not null,
  enabled integer not null,
  created_at text not null,
  updated_at text not null
);

create table if not exists user_entitlements (
  id text primary key,
  user_id text not null,
  plan_type text not null,
  status text not null,
  starts_at text not null,
  expires_at text not null,
  renewal_reminded_at text,
  source text not null,
  created_at text not null,
  updated_at text not null
);

create table if not exists notification_jobs (
  id text primary key,
  launch_event_id text not null,
  user_id text not null,
  channel text not null,
  status text not null,
  attempt_count integer not null default 0,
  last_error text,
  sent_at text,
  created_at text not null
);

create table if not exists system_message_jobs (
  id text primary key,
  user_id text not null,
  message_type text not null,
  payload text not null,
  status text not null,
  attempt_count integer not null default 0,
  last_error text,
  sent_at text,
  created_at text not null
);

create table if not exists payment_records (
  id text primary key,
  user_id text not null,
  from_wallet_address text not null,
  to_wallet_address text not null,
  tx_hash text not null unique,
  amount_bnb_wei text not null,
  credited_days integer not null,
  status text not null,
  paid_at text not null,
  raw_payload text not null,
  created_at text not null
);

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

create unique index if not exists idx_channel_bindings_active_user on channel_bindings (user_id) where status = 'active';
create unique index if not exists idx_channel_bindings_bot_channel on channel_bindings (hub_bot_id, hub_channel_id) where status = 'active';

create table if not exists wechat_bot_bindings (
  id text primary key,
  user_id text not null unique,
  bot_token text not null,
  bot_id text not null,
  account_id text not null,
  user_wx_id text not null,
  base_url text not null default 'https://ilinkai.weixin.qq.com',
  status text not null default 'active',
  bound_at text not null,
  last_poll_at text,
  last_message_at text,
  created_at text not null,
  updated_at text not null
);

create unique index if not exists idx_wechat_bot_active_user on wechat_bot_bindings (user_id) where status = 'active';
create index if not exists idx_wechat_bot_status on wechat_bot_bindings (status);

create table if not exists wechat_inbound_queue (
  id text primary key,
  binding_id text not null,
  from_user_id text not null,
  from_user_name text,
  message_type text not null,
  content text not null,
  raw_payload text not null,
  processed integer not null default 0,
  received_at text not null,
  processed_at text,
  created_at text not null
);

create index if not exists idx_wechat_queue_binding on wechat_inbound_queue (binding_id, processed);
create index if not exists idx_wechat_queue_pending on wechat_inbound_queue (processed, received_at) where processed = 0;

-- 索引
create index if not exists idx_users_wallet on users(wallet_address) where wallet_address is not null;
create index if not exists idx_users_email on users(email) where email is not null;
