-- 映画（劇場アニメ）の公開日。
-- 映画はTV放送枠を持たないため、カレンダー登録には放送日ではなく公開日を使う。
-- Annict の releasedOn（YYYY-MM-DD）を取り込む。未取得時は season から近似する。
alter table works add column if not exists released_on date;
alter table works add column if not exists released_on_about text; -- 「2026年春」等の曖昧表記（表示用）
