# アニメ放送カレンダー

放送中・放送予定のアニメ情報を閲覧し、気になった作品の放送回をカレンダー購読フィード（ICS）で受け取れる Web アプリ。

## 開発

```bash
npm install
cp .env.example .env.local   # DATA_PROVIDER=seed のままサンプルデータで起動可
npm run dev
# http://localhost:3000
```

## 技術スタック

| 層 | 採用 |
|----|------|
| フロント/サーバー | Next.js (App Router) + TypeScript + React |
| スタイル | Tailwind CSS |
| データ基盤 | Supabase (PostgreSQL) |
| 連携 | Google OAuth 2.0 / Google Calendar (ICS) |
| データ取得 | Annict / AniList / MyAnimeList |
