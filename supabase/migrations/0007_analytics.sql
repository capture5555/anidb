-- ============================================================
--  0007: アナリティクス収集基盤
--  - Annict 話数別記録数の日次スナップショット（残留率の元データ）
--  - ニコニコ実況コメントの分単位集計（盛り上がりグラフの元データ）
--  全テーブル RLS 有効・公開ポリシーなし（service role からのみ読み書き）。
-- ============================================================

-- ---------- ニコニコ実況のチャンネルID ----------
alter table channels add column if not exists jikkyo_id text;

-- 主要局のマッピング（channels.name は Annict 由来の局名）
update channels set jikkyo_id = 'jk1'   where jikkyo_id is null and name like 'NHK総合%';
update channels set jikkyo_id = 'jk2'   where jikkyo_id is null and (name like '%Eテレ%' or name = 'NHK教育');
update channels set jikkyo_id = 'jk4'   where jikkyo_id is null and name in ('日本テレビ', '日テレ');
update channels set jikkyo_id = 'jk5'   where jikkyo_id is null and name = 'テレビ朝日';
update channels set jikkyo_id = 'jk6'   where jikkyo_id is null and name like 'TBS%';
update channels set jikkyo_id = 'jk7'   where jikkyo_id is null and name = 'テレビ東京';
update channels set jikkyo_id = 'jk8'   where jikkyo_id is null and name = 'フジテレビ';
update channels set jikkyo_id = 'jk9'   where jikkyo_id is null and name = 'TOKYO MX';
update channels set jikkyo_id = 'jk141' where jikkyo_id is null and name = 'BS日テレ';
update channels set jikkyo_id = 'jk151' where jikkyo_id is null and name = 'BS朝日';
update channels set jikkyo_id = 'jk161' where jikkyo_id is null and name in ('BS-TBS', 'BSーTBS', 'BS TBS');
update channels set jikkyo_id = 'jk171' where jikkyo_id is null and name in ('BSテレ東', 'BSジャパン');
update channels set jikkyo_id = 'jk181' where jikkyo_id is null and name = 'BSフジ';
update channels set jikkyo_id = 'jk211' where jikkyo_id is null and name = 'BS11';
update channels set jikkyo_id = 'jk222' where jikkyo_id is null and name like 'BS12%';
update channels set jikkyo_id = 'jk333' where jikkyo_id is null and name = 'AT-X';

-- ---------- 残留率の元データ（話数別記録数の日次スナップショット） ----------
create table if not exists analytics_episode_stats (
  id uuid primary key default gen_random_uuid(),
  snapshot_date date not null,
  episode_id uuid not null references episodes(id) on delete cascade,
  work_id uuid not null references works(id) on delete cascade,
  records_count integer not null default 0,
  comments_count integer not null default 0,
  satisfaction_rate numeric,
  created_at timestamptz not null default now(),
  unique (snapshot_date, episode_id)
);
create index if not exists idx_aes_work on analytics_episode_stats(work_id, snapshot_date);

-- ---------- ベースライン（作品単位の日次スナップショット） ----------
create table if not exists analytics_work_stats (
  id uuid primary key default gen_random_uuid(),
  snapshot_date date not null,
  work_id uuid not null references works(id) on delete cascade,
  watchers_count integer not null default 0,
  reviews_count integer not null default 0,
  satisfaction_rate numeric,
  created_at timestamptz not null default now(),
  unique (snapshot_date, work_id)
);
create index if not exists idx_aws_work on analytics_work_stats(work_id, snapshot_date);

-- ---------- 神回グラフの元データ（分単位コメント数） ----------
create table if not exists analytics_minute_heat (
  id uuid primary key default gen_random_uuid(),
  program_id uuid not null references programs(id) on delete cascade,
  source text not null default 'nicojk',
  minute_offset integer not null,
  comment_count integer not null default 0,
  created_at timestamptz not null default now(),
  unique (program_id, source, minute_offset)
);
create index if not exists idx_amh_program on analytics_minute_heat(program_id);

-- ---------- 盛り上がりの「質」（分単位×リアクション分類） ----------
-- カテゴリ例: laugh(草/w) cry(泣いた/感動) hype(神/すげえ) surprise(!?/ファッ)
--             sakuga(作画) scream(キター/うおおお)
create table if not exists analytics_minute_reactions (
  id uuid primary key default gen_random_uuid(),
  program_id uuid not null references programs(id) on delete cascade,
  minute_offset integer not null,
  category text not null,
  count integer not null default 0,
  created_at timestamptz not null default now(),
  unique (program_id, minute_offset, category)
);
create index if not exists idx_amr_program on analytics_minute_reactions(program_id);

-- ---------- ピーク分の代表コメント（ツールチップ用） ----------
-- comments 例: [{"text":"作画やばい","count":132}, ...]（正規化後の出現数上位N件）
create table if not exists analytics_peak_comments (
  id uuid primary key default gen_random_uuid(),
  program_id uuid not null references programs(id) on delete cascade,
  minute_offset integer not null,
  comments jsonb not null default '[]',
  created_at timestamptz not null default now(),
  unique (program_id, minute_offset)
);
create index if not exists idx_apc_program on analytics_peak_comments(program_id);

-- ---------- 生ログ（API消滅リスクへの保険＋辞書改良時の再分析用） ----------
create table if not exists analytics_jikkyo_comments (
  id bigint generated always as identity primary key,
  program_id uuid not null references programs(id) on delete cascade,
  jikkyo_id text not null,
  posted_at timestamptz not null,
  content text not null,
  created_at timestamptz not null default now()
);
create index if not exists idx_ajc_program on analytics_jikkyo_comments(program_id);

-- ---------- 収集の冪等ゲート ----------
-- status: collected / no_channel / no_comments / error
-- no_channel も記録して再試行させない
create table if not exists analytics_collection_log (
  id uuid primary key default gen_random_uuid(),
  program_id uuid not null references programs(id) on delete cascade,
  source text not null default 'nicojk',
  status text not null,
  comment_count integer not null default 0,
  note text,
  collected_at timestamptz not null default now(),
  unique (program_id, source)
);

-- ---------- RLS（公開ポリシーなし = service role のみ） ----------
alter table analytics_episode_stats enable row level security;
alter table analytics_work_stats enable row level security;
alter table analytics_minute_heat enable row level security;
alter table analytics_minute_reactions enable row level security;
alter table analytics_peak_comments enable row level security;
alter table analytics_jikkyo_comments enable row level security;
alter table analytics_collection_log enable row level security;
