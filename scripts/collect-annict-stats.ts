/**
 * Annict 話数別記録数の日次スナップショットを取るCLI（GitHub Actions cron から実行）。
 *   npm run collect-annict-stats
 * 必要env: NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / ANNICT_TOKEN
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

import { collectAnnictStats } from "../lib/sync/collectAnnictStats.ts";

collectAnnictStats().then(
  (r) => {
    console.log(
      `done: seasons=${r.seasons.join(",")} work_stats=${r.workStats} episode_stats=${r.episodeStats}`,
    );
    process.exit(0);
  },
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
