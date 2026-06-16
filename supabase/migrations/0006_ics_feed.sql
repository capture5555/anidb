-- ============================================================
--  0006: ICSフィード移行
--  ※ 適用前に scripts/cleanup-google-events.ts を実行すること（順序厳守）。
--    このマイグレーションはリフレッシュトークンと calendar_events 台帳を破棄するため、
--    適用後は旧方式で書き込んだGoogleカレンダーの予定を自動削除できなくなる。
-- ============================================================

-- 1) ICSフィード用の秘密トークン（生成はアプリ側: randomBytes(24).toString("base64url")）
alter table app_users add column if not exists ics_token text unique;

-- 2) subscriptions を (user_id, work_id) で再キー化
--    旧キーは (user_id, work_id, google_calendar_id) だったため、
--    同一作品を複数カレンダーへ登録した重複行がありうる → 最新の1行だけ残す
delete from subscriptions s
using subscriptions s2
where s.user_id = s2.user_id
  and s.work_id = s2.work_id
  and (s.created_at < s2.created_at
       or (s.created_at = s2.created_at and s.id < s2.id));

alter table subscriptions
  drop constraint if exists subscriptions_user_id_work_id_google_calendar_id_key;
alter table subscriptions drop column if exists google_calendar_id;
alter table subscriptions
  add constraint subscriptions_user_id_work_id_key unique (user_id, work_id);

-- 3) 旧カレンダー書き込み方式の残骸を破棄（破壊的 — Phase 0 完了後にのみ適用）
drop table if exists calendar_events;
alter table google_accounts drop column if exists refresh_token_encrypted;
alter table google_accounts drop column if exists scopes;
alter table google_accounts drop column if exists token_updated_at;
