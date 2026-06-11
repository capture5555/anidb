/**
 * 既存 works に Annict の人気度（ウォッチャー数）を反映する。
 *   npm run enrich-popularity -- 2026-spring
 * 引数なしの場合は今期＋来期を自動で処理する。
 * 全取り込みをやり直さずに人気順ソート用の値だけ更新したいとき用。
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
  /* CI等では環境変数が直接セットされるため無視 */
}

import { fetchWorksBySeason } from "../lib/adapters/annict.ts";
import { getAdminClient } from "../lib/supabase/admin.ts";
import { seasonOf, nextSeason, seasonSlug } from "../lib/season.ts";

async function main() {
  // 引数なしなら今期＋来期を自動計算（CIでの定期実行に対応）
  let seasons: string[];
  if (process.argv[2]) {
    seasons = [process.argv[2]];
  } else {
    const now = new Date();
    const cur = seasonOf(now);
    const nxt = nextSeason(cur.year, cur.season);
    seasons = [seasonSlug(cur.year, cur.season), seasonSlug(nxt.year, nxt.season)];
  }

  const db = getAdminClient();
  const startedAt = new Date().toISOString();
  let totalUpdated = 0;
  for (const season of seasons) {
    console.log(`Annictから ${season} を取得中…`);
    const works = await fetchWorksBySeason(season);
    console.log(`${works.length} 作品の人気度を更新します`);
    let updated = 0;
    for (const w of works) {
      const { error } = await db
        .from("works")
        .update({ popularity: w.watchersCount })
        .eq("annict_id", w.annictId);
      if (!error) updated++;
    }
    console.log(`${season}: ${updated} 件の popularity を更新`);
    totalUpdated += updated;
  }
  console.log(`完了: 合計 ${totalUpdated} 件の popularity を更新`);

  try {
    await db.from("sync_runs").insert({
      started_at: startedAt,
      finished_at: new Date().toISOString(),
      status: "ok",
      created_count: 0,
      updated_count: totalUpdated,
      error_count: 0,
      note: `enrich-popularity updated=${totalUpdated} seasons=${seasons.join(",")}`,
    });
  } catch {
    /* sync_runs 記録の失敗はジョブ本体に影響させない */
  }
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
