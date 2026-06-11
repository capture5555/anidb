/**
 * 既存の works に AniList の縦ポスター画像を補完する（poster_url を更新）。
 *   npm run enrich-posters             # ポスター未設定の作品のみ
 *   npm run enrich-posters -- 2026     # 2026年の作品に限定
 *   npm run enrich-posters -- 2026 force  # 2026年を強制再取得（誤ポスターの貼り直し）
 *   npm run enrich-posters -- force    # 全作品を強制再取得
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

import { fetchPosterUrl } from "../lib/adapters/anilist.ts";
import { getAdminClient } from "../lib/supabase/admin.ts";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const args = process.argv.slice(2);
  const force = args.includes("force");
  const year = args.find((a) => /^\d{4}$/.test(a));

  const db = getAdminClient();
  let q = db.from("works").select("id, title, season_year, poster_url, popularity").order("popularity", { ascending: false });
  if (year) q = q.eq("season_year", Number(year));
  // Supabaseの1000件上限を超えるため範囲取得
  let works: any[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await q.range(from, from + 999);
    if (error) throw error;
    works.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }

  // force時は全件、通常はポスター未設定のみ
  // 人気度の高い作品を優先し、ENRICH_LIMIT 件に上限を設定（タイムアウト防止）
  const limit = Number(process.env.ENRICH_LIMIT) || 300;
  const todo = (force ? works : works.filter((w) => !w.poster_url)).slice(0, limit);
  console.log(
    `対象 ${todo.length} / ${year ?? "全"} ${works.length} 作品${force ? "（強制再取得）" : "（未設定のみ）"}（上限 ${limit} 件、人気度順）\n`,
  );

  let ok = 0;
  for (const w of todo) {
    const url = await fetchPosterUrl(w.title, w.season_year).catch(() => null);
    if (url) {
      await db.from("works").update({ poster_url: url }).eq("id", w.id);
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
