# Google OAuth 本番公開（審査）申請ガイド

個人Gmailの利用者も「警告なし」で使え、かつ**自動更新が恒久化**（テスト状態の7日失効をなくす）するには、OAuthアプリを **本番公開（Production）＋ Google審査通過** させる必要があります。

このガイドは、申請に必要な準備物（アプリ側は実装済み）と、Google Cloud Console での手順をまとめたものです。**審査自体はGoogle側で数週間**かかります。

---

## ⚠️ 最重要の前提：独自ドメインが必要

Google審査では「ホームページ」「プライバシーポリシー」を**自分が所有・検証できるドメイン**で公開する必要があります。
**`*.vercel.app` のURLは所有権を証明できないため審査を通せません。**

→ `trifstudio.com` のサブドメイン（例: **`anime.trifstudio.com`**）を本アプリに割り当ててください。

### 独自ドメインの割り当て手順（Vercel）
1. Vercel → プロジェクト `anidb` → **Settings → Domains** → `anime.trifstudio.com` を追加
2. 表示されるDNSレコード（CNAME等）を、trifstudio.com のDNS管理画面に追加
3. 反映後、`https://anime.trifstudio.com` で表示されることを確認
4. アプリの環境変数を更新（私が対応可）:
   - `NEXT_PUBLIC_APP_URL=https://anime.trifstudio.com`
   - `GOOGLE_REDIRECT_URI=https://anime.trifstudio.com/api/auth/google/callback`
5. Google Cloud のOAuthクライアントにも、このリダイレクトURIを追加 → 再デプロイ

> ✅ `trifstudio.com` は御社所有ドメインなので、Google Search Console での**所有権確認も通しやすい**はずです（Workspace導入済みなら確認済みの可能性大）。

---

## アプリ側の準備物（✅実装済み）
- ホームページ（アプリ説明）: `/`、`/about`
- **プライバシーポリシー**: `/privacy`（フッターからリンク済み）
- **利用規約**: `/terms`
- ログインは「カレンダー追加」時のみ／最小スコープ（calendar.calendarlist.readonly, calendar.events）

---

## 申請手順（Google Cloud Console）

### 1. OAuth同意画面の情報を整える
**APIとサービス → OAuth同意画面（Google Auth Platform）→ ブランディング**
- アプリ名: `アニメ放送カレンダー`
- ユーザーサポートメール: takeuchi@trifstudio.com
- アプリのロゴ: 120x120pxの正方形ロゴ（必要なら用意します）
- **アプリのホームページ**: `https://anime.trifstudio.com`
- **プライバシーポリシーURL**: `https://anime.trifstudio.com/privacy`
- **利用規約URL**: `https://anime.trifstudio.com/terms`
- **承認済みドメイン**: `trifstudio.com`

### 2. スコープの正当性（審査で説明を求められます）
登録スコープと利用理由（コピペ用）:

| スコープ | 用途の説明 |
|---|---|
| `.../auth/calendar.calendarlist.readonly` | 利用者が登録先カレンダーを選べるよう、アクセス可能なカレンダー一覧を表示するため |
| `.../auth/calendar.events` | 利用者が選んだアニメの放送予定を、利用者のカレンダーに作成・更新・削除するため（本アプリが作成した予定のみ操作） |

「なぜこのスコープが必要か」欄に上記をそのまま記載してください。

### 3. デモ動画（審査で必須）
画面録画で、以下の流れを見せる動画（限定公開YouTube等）が必要:
1. アプリのトップ → 作品詳細
2. 「Googleカレンダーへ追加」→ Googleログイン（OAuth同意画面でスコープが表示される様子）
3. カレンダーを選んで登録 → Googleカレンダーに予定が入る様子
→ 「要求スコープが、実際にこの機能で使われている」ことを示すのが目的。撮り方は私がスクリプトを用意できます。

### 4. 公開して審査に提出
**OAuth同意画面 → 「アプリを公開（PUBLISH APP）」→ Production** に切替 → 審査リクエストを送信。
- 機微スコープ（calendar.events）のため「確認をリクエスト」が表示されます。指示に従いデモ動画URL・説明を提出。

### 5. 審査中・審査後
- 審査中も、テストユーザーに追加済みの人は引き続き利用できます。
- 審査通過後は、**誰でも警告なしでログイン**でき、**リフレッシュトークンの7日失効もなくなり自動更新が恒久化**します。

---

## まとめ（あなたの作業 / 私の作業）
| 作業 | 担当 |
|---|---|
| プライバシーポリシー／利用規約ページ | ✅ 私（実装済み） |
| 独自ドメイン `anime.trifstudio.com` の割り当て（Vercel＋DNS） | 🙋 あなた（手順は上記。詰まれば私がサポート） |
| 環境変数・リダイレクトURIの更新 | 🤖 私（ドメイン決定後） |
| OAuth同意画面の入力・公開・審査提出 | 🙋 あなた（文言は上記コピペ可） |
| デモ動画の撮影 | 🙋 あなた（台本は私が用意可） |
| ロゴ作成 | 🤖 必要なら私が用意 |

まずは **独自ドメインを決める**ところからです。`anime.trifstudio.com` でよければ、Vercelでの割り当てを案内します。
