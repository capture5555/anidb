-- ============================================================
--  X(Twitter) の生ポスト収集の保存先。
--   x_search が返す「実際のポスト(URL)」を蓄積し、tweet id の Snowflake から
--   各ポストの実時刻(posted_at)を復元して、生 API なしで X エンゲージメントの
--   時系列を構築する。collector が多数のランをまたいで上積みしていく。
--   作品レベル(episode_id = null) / 話数レベル(episode_id 設定) の両方が同居する。
--   読み書きはすべて防御的(テーブル未作成なら穏当にスキップ)に行う前提。
-- ============================================================
create table if not exists analytics_x_posts (
  id bigint generated always as identity primary key,
  work_id uuid not null references works(id) on delete cascade,
  episode_id uuid references episodes(id) on delete set null,
  status_id text not null,
  url text not null,
  text text,
  posted_at timestamptz not null,
  collected_at timestamptz not null default now(),
  unique (work_id, status_id)
);
create index if not exists idx_axp_work on analytics_x_posts(work_id, posted_at);
create index if not exists idx_axp_ep on analytics_x_posts(episode_id, posted_at);
alter table analytics_x_posts enable row level security;
