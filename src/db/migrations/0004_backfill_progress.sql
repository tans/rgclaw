create table if not exists backfill_progress (
  id text primary key,
  source text not null unique,
  last_block integer not null,
  completed integer not null default 0,
  updated_at text not null
);
