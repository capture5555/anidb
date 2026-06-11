-- サイト入口の共通パスワード（複数発行・利用上限・有効期限つき）。
-- 運用者がここに行を足すことで「パスワードを複数作る」。max_uses に達するか expires_at を過ぎるか
-- active=false にすると、そのパスワードは入口で通らなくなる（＝キャンセル/失効）。
--   password   : 入口で入力する文字列（共通パスワード。プレーン保存＝運用者が管理しやすいように）
--   label      : 配布先メモ（任意）
--   active     : 有効フラグ（false で即時失効）
--   max_uses   : ログイン回数の上限（null=無制限）。used_count が達したら通らない
--   used_count : これまでのログイン成功回数（ゲート通過時に+1）
--   expires_at : 失効日時（null=無期限）
--
-- ※ ゲートは env SITE_GATE_ENABLED=1 と SITE_AUTH_SECRET が揃ったときだけ有効。
--   このテーブルが無い/空でも、ゲート無効なら通常どおり閲覧できる（ロックアウト防止）。
create table if not exists site_passwords (
  id bigint generated always as identity primary key,
  label text,
  password text not null,
  active boolean not null default true,
  max_uses integer,
  used_count integer not null default 0,
  expires_at timestamptz,
  created_at timestamptz not null default now()
);

-- 入口での突き合わせ（active な行を password で引く）用。
create index if not exists idx_site_passwords_lookup
  on site_passwords(password) where active;
