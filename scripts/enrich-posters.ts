/**
 * 既存の works に AniList の縦ポスター画像を補完する（key_visual_url を更新）。
 * 全取り込みをやり直さずにサムネイルだけ差し替えたいとき用。
 *   npm run enrich-posters
 */
import { readFileSync } from "node:fs";
const env = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
for (const line of env.split("\n")) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}

import { fetchPosterUrl } from "../lib/adapters/anilist.ts";
import { getAdminClient } from "../lib/supabase/admin.ts";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const db = getAdminClient();
  const { data: works, error } = await db
    .from("works")
    .select("id, title, season_year, key_visual_url")
    .order("title");
  if (error) throw error;

  // 既にAniListポスター済みの作品はスキップ（再実行で続きから）
  const todo = works!.filter((w) => !(w.key_visual_url ?? "").includes("anilistcdn"));
  console.log(`対象 ${todo.length} / 全 ${works!.length} 作品（済みはスキップ）\n`);

  let ok = 0;
  for (const w of todo) {
    const url = await fetchPosterUrl(w.title, w.season_year).catch(() => null);
    if (url) {
      await db.from("works").update({ key_visual_url: url }).eq("id", w.id);
      ok++;
      console.log("✓", w.title);
    } else {
      console.log("—", w.title, "(見つからず／Annict画像のまま)");
    }
    await sleep(2200); // AniListのレート制限(約30/分)に配慮
  }
  console.log(`\n完了: 今回 ${ok} 件にポスターを設定`);
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
