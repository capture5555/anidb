-- ============================================================
--  X(Twitter) バズ収集の拡張カラム（0012_x_buzz.sql の続き）。
--   - summary    : Grok の回答 markdown（X 反応の要約）。
--   - citations  : inline 引用から抽出した URL 配列。
--   - episode_id : 話数別の反応を記録する行に設定（NULL = 作品レベルの行）。
--                  同一テーブルに作品レベル/話数レベル両方の行が同居する。
--  これらは collector / 読み取り層の双方で「マイグレーション前でもクラッシュしない」
--  防御的アクセスを前提に追加する（USER が後でこのマイグレーションを適用する）。
-- ============================================================
alter table analytics_x_buzz add column if not exists summary text;
alter table analytics_x_buzz add column if not exists citations jsonb not null default '[]';
alter table analytics_x_buzz add column if not exists episode_id uuid references episodes(id) on delete cascade;
create index if not exists idx_axb_ep on analytics_x_buzz(episode_id, captured_at desc);
