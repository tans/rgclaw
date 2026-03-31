create table if not exists users (
  id text primary key,
  email text not null unique,
  password_hash text not null,
  wallet_address text,
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
  wechat_user_id text,
  bind_status text,
  bind_code text,
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

create unique index if not exists idx_user_wechat_bindings_active_user
  on user_wechat_bindings (user_id)
  where status = 'active';

create unique index if not exists idx_user_wechat_bindings_active_conversation
  on user_wechat_bindings (bot_id, bot_wechat_user_id)
  where status = 'active';

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
