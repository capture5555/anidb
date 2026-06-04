# 05. API設計

ここでは2種類の「API」を扱います。
1. **外部API**: Annict / しょぼいカレンダー / Google から **データをもらう** 窓口。
2. **アプリ内API**: 自分たちの画面が、自分たちのサーバーへ問い合わせる窓口。

---

## 1. 外部API

### 1-1. Annict API（作品メタ情報）
- 形式: **GraphQL**（`https://api.annict.com/graphql`）。アクセストークン必要（個人アクセストークンを発行）。
- 取得するもの: 作品 / シーズン / エピソード / キャスト / スタッフ / 画像 / `Program.scPid`（しょぼいカレンダー紐付けのカギ）。
- 注意: **放送予定ページは廃止済み** → 放送「時刻」の精度は期待しない。時刻はしょぼいカレンダー側を正とする。

取得イメージ（擬似クエリ）:
```graphql
query SeasonWorks($season: String!) {        # 例: "2026-spring"
  searchWorks(seasons: [$season], first: 50) {
    nodes {
      annictId title titleKana
      seasonYear seasonName
      officialSiteUrl image { recommendedImageUrl }
      episodes(first: 100) { nodes { annictId number numberText title } }
      casts(first: 100) { nodes { name character { name } } }
      staffs(first: 100) { nodes { roleText name } }
      programs(first: 100) { nodes { scPid startedAt channel { name } } }
    }
  }
}
```

### 1-2. しょぼいカレンダー（正確な放送日時）
- 形式: **REST / JSON / XML**（認証不要）。`https://cal.syoboi.jp/db.php` / `json.php`。
- 主なコマンド:
  - `ProgLookup`（TID指定で番組=放送回一覧。放送開始時刻・話数・チャンネルを含む）
  - `ProgramByDate` / `ProgramByCount`（日付/話数での絞り込み）
  - `TitleLookup`（作品情報）/ `ChLookup`（チャンネル一覧）
- 例:
  - `https://cal.syoboi.jp/db.php?Command=ProgLookup&TID=5766`
  - `https://cal.syoboi.jp/json.php?Req=ProgramByDate...`
- 取り込み: `programs.syoboi_pid` を一意キーにして重複取り込みを防止。

### 1-3. Google OAuth / Calendar API
- OAuth 2.0（認可コードフロー + offline access でリフレッシュトークン取得）。
- カレンダー一覧: `GET /calendar/v3/users/me/calendarList`
- イベント作成: `POST /calendar/v3/calendars/{calendarId}/events`
- 詳細は [06](06_GoogleOAuth設計.md) / [07](07_GoogleカレンダーAPI連携設計.md)。

### 外部API利用の鉄則
- **画面表示のたびに外部APIを叩かない**。定期バッチで自前DBへ取り込み、画面は自前DBを読む（速度・安定・規約順守）。
- 各APIの利用規約・レート制限を守る。取得層を1モジュールに分離（差し替え可能に）。

---

## 2. アプリ内API（Next.js のサーバー側エンドポイント）

REST形式で設計（Next.js App Router の Route Handlers / Server Actions で実装）。

### 公開（ログイン不要）エンドポイント

| メソッド | パス | 役割 | 主なパラメータ |
|----------|------|------|----------------|
| GET | `/api/works` | 一覧取得 | `season`, `status`, `genre`, `q`, `page` |
| GET | `/api/works/{id}` | 作品詳細（話・キャスト・スタッフ込み） | – |
| GET | `/api/seasons` | 利用可能なシーズン一覧 | – |
| GET | `/api/genres` | ジャンル一覧 | – |

`GET /api/works` レスポンス例:
```json
{
  "items": [
    {
      "id": "uuid",
      "title": "葬送のフリーレン",
      "keyVisualUrl": "https://...",
      "seasonYear": 2026, "seasonName": "spring",
      "status": "airing",
      "genres": ["ファンタジー", "冒険"]
    }
  ],
  "page": 1, "hasNext": true
}
```

### 認証必須エンドポイント（カレンダー連携）

| メソッド | パス | 役割 |
|----------|------|------|
| GET | `/api/auth/google/start` | OAuth開始（Googleへリダイレクト） |
| GET | `/api/auth/google/callback` | OAuthコールバック（トークン交換・保存） |
| GET | `/api/me/calendars` | 自分のGoogleカレンダー一覧を取得 |
| POST | `/api/subscriptions` | 作品をカレンダーに登録（追跡開始＋直近予定の即時登録） |
| GET | `/api/me/subscriptions` | 自分の登録一覧 |
| PATCH | `/api/subscriptions/{id}` | 登録の変更（カレンダー変更/一時停止/形式変更） |
| DELETE | `/api/subscriptions/{id}` | 登録解除（任意で登録済みイベントも削除） |

`POST /api/subscriptions` リクエスト例:
```json
{
  "workId": "uuid",
  "googleCalendarId": "team-shared@group.calendar.google.com",
  "mode": "per_episode",
  "includeSubtitle": true,
  "includeChannel": true,
  "includeUrl": true
}
```
処理内容:
1. 認証チェック（未ログインなら401 → 画面はOAuthへ誘導）
2. `subscriptions` を作成（重複時は既存を返す）
3. 既知の未来の `programs` を取得し、`calendar_events` に無い分だけGoogleへ作成
4. 作成結果（件数）を返却。以降は自動更新（[08](08_自動更新方式.md)）に委ねる

### 内部（サーバー専用・cronから呼ぶ）

| メソッド | パス | 役割 |
|----------|------|------|
| POST | `/api/internal/ingest` | Annict+しょぼいから最新データを取り込み（works/episodes/programs更新） |
| POST | `/api/internal/sync-calendars` | 全active subscriptionの未登録予定をGoogleへ反映 |

> これらはトークン/シークレットで保護し、Supabase Cron（pg_cron）や Vercel Cron からのみ起動する。

## 3. エラーとレスポンス方針
- 成功は `2xx`、未認証は `401`、権限なし `403`、対象なし `404`、外部API失敗は `502/503`。
- 自動更新系は「失敗した1件でジョブ全体を止めない」（1件ずつtry/catch、`sync_runs`/`calendar_events.status=failed`に記録し次回再試行）。
