/**
 * ニコニコ実況の過去ログを収集するCLI（GitHub Actions cron から3時間おきに実行）。
 *   npm run collect-jikkyo
 * 必要env: NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY
 * 冪等（analytics_collection_log がゲート）なので重複実行してもよい。
 */
import { readFileSync } from "node:fs";

// .env.local を手動ロード（単体nodeスクリプトはNext.jsと違い自動で読まないため）
try {
  const env = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
  for (const line of env.split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
} catch {
  /* 環境変数があれば動く */
}

import { collectJikkyo } from "../lib/sync/collectJikkyo.ts";

collectJikkyo().then(
  (r) => {
    console.log(
      `done: candidates=${r.candidates} collected=${r.collected} no_channel=${r.noChannel} no_comments=${r.noComments} errors=${r.errors}`,
    );
    process.exit(r.errors > 0 ? 1 : 0);
  },
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
