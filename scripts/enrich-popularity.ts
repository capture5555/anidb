/**
 * 既存 works に Annict の人気度（ウォッチャー数）を反映する。
 *   npm run enrich-popularity -- 2026-spring
 * 全取り込みをやり直さずに人気順ソート用の値だけ更新したいとき用。
 */
import { readFileSync } from "node:fs";
const env = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
for (const line of env.split("\n")) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}

import { fetchWorksBySeason } from "../lib/adapters/annict.ts";
import { getAdminClient } from "../lib/supabase/admin.ts";

async function main() {
  const season = process.argv[2] ?? "2026-spring";
  const db = getAdminClient();
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
  console.log(`完了: ${updated} 件の popularity を更新`);
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
