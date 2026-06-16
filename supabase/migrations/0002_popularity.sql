-- 人気順ソート用の列を追加（既存DBへの追加適用用）
alter table works add column if not exists popularity integer not null default 0;
create index if not exists idx_works_popularity on works (popularity desc);
