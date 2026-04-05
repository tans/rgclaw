-- 添加微信 Bot 直接绑定支持（使用 @wechatbot/wechatbot SDK）
-- 新表：存储用户的微信 Bot 凭证

create table if not exists wechat_bot_bindings (
  id text primary key,
  user_id text not null unique,  -- 一个用户只能绑定一个微信 Bot
  
  -- Bot 凭证（来自 ilinkai.weixin.qq.com）
  bot_token text not null,        -- Bearer token
  bot_id text not null,           -- ilink_bot_id
  account_id text not null,       -- ilink account id
  user_wx_id text not null,       -- 用户微信ID
  base_url text not null default 'https://ilinkai.weixin.qq.com',
  
  -- 状态管理
  status text not null default 'active',  -- active, inactive, expired
  
  -- 时间戳
  bound_at text not null,
  last_poll_at text,              -- 最后轮询消息时间
  last_message_at text,           -- 最后收到消息时间
  created_at text not null,
  updated_at text not null
);

-- 索引
create unique index if not exists idx_wechat_bot_active_user 
  on wechat_bot_bindings (user_id) 
  where status = 'active';

create index if not exists idx_wechat_bot_status 
  on wechat_bot_bindings (status);

-- 消息队列表（用于存储待处理的消息）
create table if not exists wechat_inbound_queue (
  id text primary key,
  binding_id text not null,
  from_user_id text not null,     -- 发消息的用户微信ID
  from_user_name text,            -- 发消息的用户昵称
  message_type text not null,     -- text, image, voice, video, file
  content text not null,          -- 消息内容（文本或JSON）
  raw_payload text not null,      -- 原始消息JSON
  processed integer not null default 0,  -- 0=pending, 1=processed
  received_at text not null,
  processed_at text,
  created_at text not null
);

create index if not exists idx_wechat_queue_binding 
  on wechat_inbound_queue (binding_id, processed);

create index if not exists idx_wechat_queue_pending 
  on wechat_inbound_queue (processed, received_at) 
  where processed = 0;
