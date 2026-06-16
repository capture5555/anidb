-- ============================================================
--  X(Twitter) バズ収集の保存先（xAI x_search / Live Search の結果）。
--  cron-x-buzz が6時間おきに今期放送中TV作品のバズ状況を1行ずつ記録する。
-- ============================================================
create table if not exists analytics_x_buzz (
  id uuid primary key default gen_random_uuid(),
  work_id uuid not null references works(id) on delete cascade,
  captured_at timestamptz not null default now(),
  window_hours integer not null,
  volume_score integer not null,
  sentiment text,
  topics jsonb not null default '[]',
  quotes jsonb not null default '[]',
  unique (work_id, captured_at)
);
create index if not exists idx_axb_work on analytics_x_buzz(work_id, captured_at desc);
alter table analytics_x_buzz enable row level security;
