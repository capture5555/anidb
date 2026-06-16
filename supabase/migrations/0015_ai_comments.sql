-- AIコメント／ニュースの履歴テーブル。
-- 生成のたびに1行 append し、generated_at で過去分を遡って見返せるようにする。
--   scope  : 'season'(今期の所感) | 'work'(作品の声) | 'episode'(各話の声) | 'news'(今日のニュース) など
--   ref_id : work_id / episode_id / シーズンラベル / ニュース日付(YYYY-MM-DD) など（scope内の対象キー）
--   title  : 見出し（作品名・日付など、任意）
--   body   : 本文（所感・要約）。news の場合は概況文など（明細は meta.items）
--   meta   : 付随情報（volume/sentiment/topics、news の items 配列など）
--
-- 読み取りは防御的（テーブルが無ければ空配列にフォールバック）なので、
-- このマイグレーション適用前でもアプリは動作する（履歴UIが空になるだけ）。
create table if not exists ai_comments (
  id bigint generated always as identity primary key,
  scope text not null,
  ref_id text,
  title text,
  body text not null,
  meta jsonb not null default '{}'::jsonb,
  generated_at timestamptz not null default now()
);

-- 対象（scope+ref_id）ごとに新しい順で履歴を引くため。
create index if not exists idx_ai_comments_scope_ref
  on ai_comments(scope, ref_id, generated_at desc);
-- 全体の新着順（ニュースの日次一覧・横断履歴用）。
create index if not exists idx_ai_comments_generated
  on ai_comments(generated_at desc);
