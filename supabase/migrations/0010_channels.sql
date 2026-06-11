-- Stage 1: グローバルな放送局選択（おすすめ順の複数選択）を地域セレクタの代わりに使う。
-- app_users.preferred_channels: ユーザーが「視聴できる放送局」として選んだ正規化済みチャンネル名の配列。
-- subscriptions.channels: Stage 2（作品ごとの放送局上書き）用。今は列だけ追加しておく。
alter table app_users add column if not exists preferred_channels text[];
alter table subscriptions add column if not exists channels text[];
