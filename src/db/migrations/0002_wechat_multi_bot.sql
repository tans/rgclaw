create table user_wechat_bindings_v2 (
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

insert into user_wechat_bindings_v2 (
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
)
select
  id,
  user_id,
  'legacy' as bot_id,
  coalesce(wechat_user_id, '') as bot_wechat_user_id,
  case
    when bind_status = 'bound' then 'active'
    else 'inactive'
  end as status,
  bound_at,
  null as unbound_at,
  bound_at as last_inbound_at,
  null as last_outbound_at,
  null as last_keepalive_sent_at,
  null as last_context_token,
  last_error,
  coalesce(bound_at, datetime('now')) as created_at,
  coalesce(bound_at, datetime('now')) as updated_at
from user_wechat_bindings;

drop table user_wechat_bindings;

alter table user_wechat_bindings_v2 rename to user_wechat_bindings;

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
