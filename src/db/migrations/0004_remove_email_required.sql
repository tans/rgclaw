-- 移除 users 表的 email 必填约束
-- 钱包登录模式下不需要邮箱

-- 1. 创建新表结构（email 可为空）
create table if not exists users_new (
  id text primary key,
  email text,  -- 改为可为空
  password_hash text,  -- 改为可为空
  wallet_address text unique,  -- 钱包地址唯一
  wallet_address_updated_at text,
  created_at text not null,
  updated_at text not null
);

-- 2. 复制数据（将现有用户的 email 保留，但允许新用户没有 email）
insert into users_new (
  id, email, password_hash, wallet_address, wallet_address_updated_at, created_at, updated_at
)
select 
  id, email, password_hash, wallet_address, wallet_address_updated_at, created_at, updated_at
from users;

-- 3. 删除旧表，重命名新表
drop table users;
alter table users_new rename to users;

-- 4. 创建索引
create index if not exists idx_users_wallet on users(wallet_address) where wallet_address is not null;
create index if not exists idx_users_email on users(email) where email is not null;
