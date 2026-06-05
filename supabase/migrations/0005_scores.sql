-- 海外スコア(AniList) / MAL評価 の保存列。ingestは触らず enrich-scores が更新する。
alter table works add column if not exists anilist_score integer;       -- 0-100
alter table works add column if not exists anilist_popularity integer;  -- 海外登録者数
alter table works add column if not exists mal_id integer;
alter table works add column if not exists mal_score numeric(4,2);       -- 0-10
alter table works add column if not exists mal_scored_by integer;        -- 評価人数
alter table works add column if not exists mal_members integer;          -- 登録者数

create index if not exists idx_works_anilist_score on works (anilist_score desc);
create index if not exists idx_works_mal_score on works (mal_score desc);
