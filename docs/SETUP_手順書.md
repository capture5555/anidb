# セットアップ手順書（非エンジニア向け・クリック手順つき）

「デモが動く状態」から「会社の人が実際に使える状態」にするための手順です。
**上から順番に**進めてください。各サービスのアカウント作成・鍵の取得は、本人ログインが必要なため**あなたの作業**です。鍵さえ揃えば、設定〜公開は私（Claude）が代行できます。

---

## 進め方の全体像

```
STEP 1  Supabase      … データの保管庫を用意（無料）
STEP 2  Annict        … 作品情報の取得元トークンを発行
STEP 3  ★紐付け検証   … Annictとしょぼいが繋がるか先に確認（最重要・所要5分）
STEP 4  Google Cloud  … カレンダー連携の許可設定
STEP 5  鍵をアプリに設定 … .env.local を本番設定に
STEP 6  データ取り込み  … 今期アニメを投入
STEP 7  動作テスト      … ログイン→登録→カレンダー確認
STEP 8  公開(Vercel)    … ネットに上げ、自動更新をON
```

各STEPで「**もらう鍵**」を最後の [チェックリスト](#-鍵チェックリスト) に書き写していくと、STEP 5がスムーズです。

---

## STEP 1. Supabase（データの保管庫）

1. https://supabase.com にアクセス →「Start your project」→ GitHubアカウント等でサインアップ。
2. 「New project」をクリック。
   - Name: `anidb`（任意）
   - Database Password: 自動生成でOK（控えておく）
   - Region: `Northeast Asia (Tokyo)` を推奨。
3. 作成後、左メニュー **SQL Editor** を開く →「New query」。
4. リポジトリの [`supabase/migrations/0001_init.sql`](../supabase/migrations/0001_init.sql) の中身を**全部コピペ** →「Run」。
   - 「Success」と出ればテーブル作成完了。
5. 左メニュー **Project Settings → API** を開き、以下3つを控える：
   - **Project URL**（`https://xxxx.supabase.co`）
   - **anon public** キー
   - **service_role** キー（⚠️秘密。絶対に他人に渡さない）

> 📌 もらう鍵: `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY`

---

## STEP 2. Annict（作品情報の取得元）

1. https://annict.com にアクセス → アカウント作成（GitHub/Twitter等でログイン可）。
2. ログイン後、**https://annict.com/settings/apps** を開く（※`/settings/tokens` ではない。左メニュー「設定 → アプリ」）。
3. 「個人用アクセストークン（Personal Access Token）」のセクションで、説明欄に `anidb` 等 → 権限は `read` でOK → 作成。
4. 表示されたトークン文字列を控える（再表示できないことがあるので必ずコピー）。

> 参考: https://developers.annict.com/docs/authentication/personal-access-token

> 📌 もらう鍵: `ANNICT_TOKEN`

---

## STEP 3. ★紐付け検証（最重要・所要5分）

本番化の前に、**このアプリ最大の不確実要素**＝「Annictとしょぼいカレンダーが自動で繋がるか」を確認します。

1. プロジェクトの `.env.local` の `ANNICT_TOKEN=` に STEP 2 のトークンを貼る。
2. ターミナルで以下を実行：
   ```bash
   npm run verify-linking
   ```
3. 作品ごとに「scPid → TID → 放送回取得」が成功したかと、最後に**紐付け成功率**が表示されます。

> ✅ 成功率が高ければ（目安70%以上）そのまま進行。
> △ 低ければ、突合ロジックの調整や「手動でsyoboi_tidを補正する運用」を検討（私に相談してください）。

※このSTEPはSupabase不要・Annictトークンだけで動きます。**鍵を取得したら、ここだけ私に実行させてもOKです。**

---

## STEP 4. Google Cloud（カレンダー連携の許可）

> 💡 **誰のGoogleアカウントで作るか**: 退職等で消えないよう、できれば**会社の管理用アカウント**で作成を推奨。

1. https://console.cloud.google.com にアクセス → プロジェクト作成（名前 `anidb` 等）。
2. 左メニュー **APIとサービス → ライブラリ** →「Google Calendar API」を検索して**有効化**。
3. **APIとサービス → OAuth同意画面**:
   - User Type: **外部** を選択 →「作成」。
   - アプリ名 `アニメ放送カレンダー`、サポートメール等を入力。
   - スコープ: `.../auth/calendar.calendarlist.readonly` と `.../auth/calendar.events` を追加。
   - **テストユーザー**: 使う人（あなたや社内メンバー）のGmailアドレスを追加。
     → 身内利用ならこの「テスト」状態のままでOK（Googleの審査不要）。
4. **APIとサービス → 認証情報 →「認証情報を作成」→ OAuth クライアント ID**:
   - アプリの種類: **ウェブ アプリケーション**。
   - 承認済みリダイレクト URI に以下を追加：
     - `http://localhost:3000/api/auth/google/callback`（ローカルテスト用）
     - 公開後は `https://（本番ドメイン）/api/auth/google/callback` も追加。
   - 作成後、**クライアントID** と **クライアントシークレット** を控える。

> 📌 もらう鍵: `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`

---

## STEP 5. 鍵をアプリに設定（ここから私が代行可能）

`.env.local` を以下のように埋めます（STEP 1〜4で控えた値）。

```bash
NEXT_PUBLIC_APP_URL=http://localhost:3000
DATA_PROVIDER=supabase            # ← seed から supabase に変更

NEXT_PUBLIC_SUPABASE_URL=（STEP1）
NEXT_PUBLIC_SUPABASE_ANON_KEY=（STEP1）
SUPABASE_SERVICE_ROLE_KEY=（STEP1）

GOOGLE_CLIENT_ID=（STEP4）
GOOGLE_CLIENT_SECRET=（STEP4）
GOOGLE_REDIRECT_URI=http://localhost:3000/api/auth/google/callback

ANNICT_TOKEN=（STEP2）

# 下記2つは自動生成（コマンドは下）
TOKEN_ENCRYPTION_KEY=
SESSION_SECRET=
INTERNAL_API_SECRET=
```

鍵の生成コマンド：
```bash
# リフレッシュトークン暗号化キー（64文字hex）
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
# セッション用・内部API用（適当な長い文字列でOK）
node -e "console.log(require('crypto').randomBytes(24).toString('base64url'))"
```

> ⚠️ `.env.local` は秘密情報です。Gitには上がりません（`.gitignore`済み）。他人に共有しないでください。

---

## STEP 6. データ取り込み（今期アニメを投入）

```bash
npm run ingest            # 今シーズン + 来シーズンを取り込み
# npm run ingest -- 2026-summer   # シーズン指定も可
```
完了すると Supabase の `works` などにデータが入り、`npm run dev` で**実データ**が表示されます。

---

## STEP 7. 動作テスト

```bash
npm run dev   # http://localhost:3000
```
1. 一覧・詳細が実データで表示されるか。
2. 作品詳細の「Googleカレンダーへ追加」→ Googleログイン → カレンダー選択 → 登録。
3. 自分のGoogleカレンダーに `【アニメ】作品名 第○話` が入っているか。
4. 同じ作品をもう一度登録 → **重複しない**ことを確認。

---

## STEP 8. 公開（Vercel）＋自動更新

1. https://vercel.com に GitHub でログイン →「Add New → Project」。
2. リポジトリ `capture5555/anidb` を選択（プライベートのまま連携可）。
3. **Environment Variables** に `.env.local` の中身を全部登録。
   - `NEXT_PUBLIC_APP_URL` と `GOOGLE_REDIRECT_URI` は**本番ドメイン**に書き換える。
4. デプロイ実行。
5. STEP 4 のリダイレクトURIに**本番ドメイン版**を追加（忘れやすい）。
6. 自動更新は [`vercel.json`](../vercel.json) のcron定義により、デプロイ後**毎日自動実行**されます。
   - `/api/internal/ingest`（最新データ取り込み）
   - `/api/internal/sync-calendars`（未登録の放送回を各人のカレンダーへ）

---

## 📋 鍵チェックリスト

取得したらここに書き写すと STEP 5 が楽です（このファイルはGitに上がるので、**実際の値は書かず**手元メモに）。

| 変数 | 取得元 | 取得済み |
|------|--------|:--------:|
| `NEXT_PUBLIC_SUPABASE_URL` | STEP1 | ☐ |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | STEP1 | ☐ |
| `SUPABASE_SERVICE_ROLE_KEY` | STEP1 | ☐ |
| `ANNICT_TOKEN` | STEP2 | ☐ |
| `GOOGLE_CLIENT_ID` | STEP4 | ☐ |
| `GOOGLE_CLIENT_SECRET` | STEP4 | ☐ |
| `TOKEN_ENCRYPTION_KEY` | STEP5(生成) | ☐ |
| `SESSION_SECRET` | STEP5(生成) | ☐ |
| `INTERNAL_API_SECRET` | STEP5(生成) | ☐ |

---

## 困ったら
- STEP 3 で紐付け率が低い／STEP 7 でカレンダー登録が失敗する等、詰まったらその画面の表示やエラーを伝えてください。都度サポートします。
- 「鍵を渡すので設定〜公開をやってほしい」も可能です（STEP 5以降は代行できます）。
