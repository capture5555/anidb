-- ============================================================
--  aniDB 初期スキーマ（docs/04 DB設計 に対応）
--  Supabase の SQL Editor もしくは supabase db push で適用。
-- ============================================================

create extension if not exists "pgcrypto";

-- ---------- コンテンツ系 ----------

create table if not exists works (
  id uuid primary key default gen_random_uuid(),
  annict_id bigint unique,
  syoboi_tid integer,
  title text not null,
  title_kana text,
  title_en text,
  synopsis text,
  official_site_url text,
  media text,
  season_year integer,
  season_name text check (season_name in ('winter','spring','summer','autumn')),
  status text not null default 'upcoming' check (status in ('upcoming','airing','finished')),
  key_visual_url text,
  poster_url text,                         -- 縦ポスター（AniList。ingestは触らない）
  popularity integer not null default 0,  -- 人気指標（Annictウォッチャー数）
  anilist_score integer,                   -- AniList平均スコア(0-100, 海外)
  anilist_popularity integer,              -- AniList登録者数(海外)
  mal_id integer,
  mal_score numeric(4,2),                  -- MALスコア(0-10)
  mal_scored_by integer,
  mal_members integer,
  company_id uuid,
  source_updated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_works_season on works(season_year, season_name, status);
create index if not exists idx_works_status on works(status);

create table if not exists episodes (
  id uuid primary key default gen_random_uuid(),
  work_id uuid not null references works(id) on delete cascade,
  annict_episode_id bigint,
  number numeric,
  number_text text,
  title text,
  title_source text check (title_source in ('annict','syoboi','manual')),
  sort integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (work_id, number)
);
create index if not exists idx_episodes_work on episodes(work_id);

create table if not exists channels (
  id uuid primary key default gen_random_uuid(),
  name text unique not null,
  syoboi_chid integer
);

create table if not exists programs (
  id uuid primary key default gen_random_uuid(),
  work_id uuid not null references works(id) on delete cascade,
  episode_id uuid references episodes(id) on delete set null,
  channel_id uuid references channels(id) on delete set null,
  count numeric,
  start_at timestamptz not null,
  end_at timestamptz,
  is_rebroadcast boolean not null default false,
  annict_program_id bigint unique,  -- Annictの放送回ID（重複取り込み防止の要）
  syoboi_pid integer unique,         -- 将来しょぼいカレンダーで補完する場合用
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_programs_work on programs(work_id);
create index if not exists idx_programs_start on programs(start_at);

create table if not exists genres (
  id uuid primary key default gen_random_uuid(),
  name text unique not null
);

create table if not exists work_genres (
  work_id uuid not null references works(id) on delete cascade,
  genre_id uuid not null references genres(id) on delete cascade,
  primary key (work_id, genre_id)
);

create table if not exists work_casts (
  id uuid primary key default gen_random_uuid(),
  work_id uuid not null references works(id) on delete cascade,
  character_name text not null,
  person_id uuid,
  person_name text not null,
  sort integer not null default 0
);
create index if not exists idx_casts_work on work_casts(work_id);

create table if not exists work_staff (
  id uuid primary key default gen_random_uuid(),
  work_id uuid not null references works(id) on delete cascade,
  role text not null,
  person_id uuid,
  person_name text not null,
  sort integer not null default 0
);
create index if not exists idx_staff_work on work_staff(work_id);

-- 将来拡張の受け皿（声優/会社ページ）
create table if not exists persons (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  name_kana text,
  annict_person_id bigint unique,
  profile text,
  image_url text
);
create table if not exists companies (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  annict_org_id bigint unique
);

-- ---------- ユーザー・連携系 ----------

create table if not exists app_users (
  id uuid primary key,
  email text,
  display_name text,
  created_at timestamptz not null default now()
);

create table if not exists google_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references app_users(id) on delete cascade,
  google_sub text unique not null,
  refresh_token_encrypted text,
  scopes text[],
  token_updated_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists idx_google_accounts_user on google_accounts(user_id);

create table if not exists subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references app_users(id) on delete cascade,
  work_id uuid not null references works(id) on delete cascade,
  google_calendar_id text not null,
  mode text not null default 'per_episode' check (mode in ('per_episode','whole')),
  include_subtitle boolean not null default true,
  include_channel boolean not null default true,
  include_url boolean not null default true,
  auto_sync boolean not null default true,
  status text not null default 'active' check (status in ('active','paused','cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, work_id, google_calendar_id)
);
create index if not exists idx_subs_user on subscriptions(user_id);
create index if not exists idx_subs_active on subscriptions(status, auto_sync);

create table if not exists calendar_events (
  id uuid primary key default gen_random_uuid(),
  subscription_id uuid not null references subscriptions(id) on delete cascade,
  program_id uuid not null references programs(id) on delete cascade,
  google_calendar_id text not null,
  google_event_id text,
  status text not null default 'created' check (status in ('created','updated','deleted','failed')),
  content_hash text,
  synced_at timestamptz,
  created_at timestamptz not null default now(),
  unique (subscription_id, program_id)  -- ★ 重複登録防止の要
);
create index if not exists idx_calevents_sub on calendar_events(subscription_id);

create table if not exists sync_runs (
  id uuid primary key default gen_random_uuid(),
  started_at timestamptz,
  finished_at timestamptz,
  status text,
  created_count integer default 0,
  updated_count integer default 0,
  error_count integer default 0,
  note text
);

-- ---------- RLS（行レベルセキュリティ） ----------
-- 閲覧系は誰でも読み取り可。書き込みは service_role のみ（= サーバー処理）。
-- 個人系は本人のみ。

alter table works enable row level security;
alter table episodes enable row level security;
alter table channels enable row level security;
alter table programs enable row level security;
alter table genres enable row level security;
alter table work_genres enable row level security;
alter table work_casts enable row level security;
alter table work_staff enable row level security;
alter table persons enable row level security;
alter table companies enable row level security;

-- 公開読み取り
do $$
declare t text;
begin
  foreach t in array array['works','episodes','channels','programs','genres','work_genres','work_casts','work_staff','persons','companies']
  loop
    execute format('drop policy if exists "public_read" on %I;', t);
    execute format('create policy "public_read" on %I for select using (true);', t);
  end loop;
end $$;

-- 個人系
alter table app_users enable row level security;
alter table google_accounts enable row level security;
alter table subscriptions enable row level security;
alter table calendar_events enable row level security;
alter table sync_runs enable row level security;

drop policy if exists "self_app_users" on app_users;
create policy "self_app_users" on app_users
  for select using (auth.uid() = id);

drop policy if exists "self_subscriptions" on subscriptions;
create policy "self_subscriptions" on subscriptions
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- google_accounts / calendar_events / sync_runs は通常クライアントからは触らせず、
-- service_role（サーバー）経由のみ。よって select ポリシーを付けない（既定で拒否）。

-- updated_at 自動更新トリガ
create or replace function set_updated_at() returns trigger as $$
begin new.updated_at = now(); return new; end;
$$ language plpgsql;

do $$
declare t text;
begin
  foreach t in array array['works','episodes','programs','subscriptions']
  loop
    execute format('drop trigger if exists trg_updated_at on %I;', t);
    execute format('create trigger trg_updated_at before update on %I for each row execute function set_updated_at();', t);
  end loop;
end $$;
