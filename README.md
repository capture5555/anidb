# アニメ放送カレンダー (aniDB)

放送中・放送予定のアニメ情報をまとめて閲覧し、気になった作品だけをGoogleカレンダーへ登録できる、社内・身内向けWebアプリ。

- 閲覧はログイン不要。**「Googleカレンダーへ追加」を押したときだけ** Google認証。
- 登録後は、**PCを起動していなくても** サーバー側の定期処理で新しい放送回が自動追加される（重複なし）。
- デザイン: オフホワイト基調のエディトリアル（明朝見出し・ヘアライン罫）。

設計の詳細は [`docs/`](docs/00_README_設計ドキュメント目次.md) を参照。

---

## すぐ動かす（デモモード）

外部サービスの設定は不要。同梱のサンプルデータで全画面・操作フローを確認できます。

```bash
npm install
cp .env.example .env.local   # DATA_PROVIDER=seed のままでOK
npm run dev
# http://localhost:3000
```

- 一覧（今期/来期/放送中/放送予定タブ・検索・ジャンル絞り込み）
- 作品詳細（あらすじ/エピソード/キャスト/スタッフ/放送情報）
- 「Googleカレンダーへ追加」→ 登録モーダル（デモでは実登録せず流れを確認）

## 技術スタック

| 層 | 採用 |
|----|------|
| フロント/サーバー | Next.js (App Router) + TypeScript + React |
| スタイル | Tailwind CSS v4（オフホワイトのデザイントークン） |
| データ基盤 | Supabase (PostgreSQL + 認証 + RLS) |
| 公開 | Vercel（Cronで定期実行） |
| 連携 | Google OAuth 2.0 / Google Calendar API |
| データ取得 | Annict GraphQL（作品メタ）+ しょぼいカレンダー（正確な放送時刻） |

## ディレクトリ

```
app/                  画面・APIルート
  page.tsx            トップ（一覧）
  works/[id]/         作品詳細
  me/                 マイ登録一覧
  api/                アプリ内API（works/subscriptions/auth/internal …）
components/           UI部品（カード・モーダル等）
lib/
  data/               データ層（seed / supabase の差し替え）
  adapters/           外部API（annict.ts / syoboi.ts）
  google/             OAuth・Calendar・トークン
  sync/               ingest（取り込み）・syncCalendars（同期）・eventBuilder
  crypto.ts session.ts accounts.ts
supabase/migrations/  DBスキーマ（0001_init.sql）
docs/                 設計ドキュメント
scripts/ingest.ts     取り込みCLI
```

## 本番セットアップ

### 1. Supabase
1. プロジェクトを作成。
2. SQL Editor で [`supabase/migrations/0001_init.sql`](supabase/migrations/0001_init.sql) を実行。
3. `.env.local` に `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY` を設定し、`DATA_PROVIDER=supabase` にする。

### 2. Annict
- https://annict.com/settings/tokens で個人アクセストークンを発行し `ANNICT_TOKEN` に設定。

### 3. Google OAuth
1. Google Cloud Console でOAuthクライアント（ウェブ）を作成。
2. リダイレクトURIに `http://localhost:3000/api/auth/google/callback`（本番ドメインも）を登録。
3. `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` / `GOOGLE_REDIRECT_URI` を設定。
4. スコープ: `calendar.calendarlist.readonly` / `calendar.events`（+ openid/email/profile）。
5. 身内利用なら「テストユーザー」運用で審査を回避できる場合が多い（[docs/06](docs/06_GoogleOAuth設計.md)）。

### 4. 鍵類
```bash
# リフレッシュトークン暗号化キー（64 hex）
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"  # → TOKEN_ENCRYPTION_KEY
```
`SESSION_SECRET`（任意の長い文字列）、`INTERNAL_API_SECRET`（cron保護用）も設定。

### 5. 取り込み（初回データ投入）
```bash
npm run ingest                 # 今期+来期
npm run ingest -- 2026-spring  # シーズン指定
```

### 6. 自動更新（Vercel Cron）
[`vercel.json`](vercel.json) に定義済み。Vercelにデプロイすると以下が毎日実行される（時刻はUTC）。
- `/api/internal/ingest` … Annict+しょぼいから最新データを取り込み
- `/api/internal/sync-calendars` … 未登録の放送回を各ユーザーのカレンダーへ反映

Supabase Cron（pg_cron）を使う場合は、上記2エンドポイントを `Authorization: Bearer $INTERNAL_API_SECRET` 付きで叩くジョブを登録する。

## 重複防止の仕組み
`calendar_events` に `unique(subscription_id, program_id)` を持たせ、登録前に台帳を確認して未登録の回だけ作成する。さらにイベントに `extendedProperties`（programId等）を付与し、台帳とのズレを自己修復できる。内容（サブタイトル・時刻）が変わった回は `content_hash` の差分で検知して更新する。詳細は [docs/07](docs/07_GoogleカレンダーAPI連携設計.md)。

## コマンド
| コマンド | 説明 |
|----------|------|
| `npm run dev` | 開発サーバー |
| `npm run build` | 本番ビルド（型チェック含む） |
| `npm run start` | 本番起動 |
| `npm run ingest` | 取り込みCLI |
