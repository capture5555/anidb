-- 縦ポスター専用の列。取り込み(ingest)は触らないため、毎日の更新でも消えない。
alter table works add column if not exists poster_url text;

-- 既に key_visual_url に入っているAniListポスターを poster_url へ引き継ぐ
update works set poster_url = key_visual_url
where key_visual_url like '%anilistcdn%' and poster_url is null;
