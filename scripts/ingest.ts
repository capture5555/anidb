/**
 * 取り込みをローカルから手動実行するCLI。
 *   npm run ingest                  # 今期+来期
 *   npm run ingest -- 2026-spring   # シーズン指定
 *
 * 事前に .env.local に SUPABASE_* と ANNICT_TOKEN を設定しておくこと。
 * Node 26 の --experimental-strip-types で .ts を直接実行する（package.json参照）。
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

import { ingestSeason } from "../lib/sync/ingest.ts";
import { seasonOf, nextSeason, seasonSlug } from "../lib/season.ts";

async function main() {
  const arg = process.argv[2];
  let seasons: string[];
  if (arg) {
    seasons = [arg];
  } else {
    const now = new Date();
    const cur = seasonOf(now);
    const nxt = nextSeason(cur.year, cur.season);
    seasons = [seasonSlug(cur.year, cur.season), seasonSlug(nxt.year, nxt.season)];
  }

  for (const s of seasons) {
    console.log(`\n=== ingest ${s} ===`);
    const r = await ingestSeason(s);
    console.log(r);
  }
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
