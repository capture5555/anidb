-- 解析スナップショット: 重い全件集計を cron で事前計算して保存する。
-- ページはこのテーブルを読むだけにし、リクエスト経路から重い集計を外す。
-- 読み取りは防御的（テーブル/行が無ければ LIVE 計算へフォールバック）なので、
-- このマイグレーション適用前でもアプリは動作する（従来どおりの速度）。
create table if not exists analytics_snapshots (
  key text primary key,
  payload jsonb not null,
  computed_at timestamptz not null default now()
);

-- フルテーブルスキャンが多かった集計のための補助インデックス。
create index if not exists idx_acl_status on analytics_collection_log(status, comment_count desc);
create index if not exists idx_amh_count on analytics_minute_heat(comment_count desc);
create index if not exists idx_ws_role on work_staff(role, person_name);
