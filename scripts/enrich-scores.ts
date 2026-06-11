/**
 * 既存 works に AniList スコア/登録者数・あらすじ・ジャンル と MAL 評価(Jikan, idMal経由)を補完する。
 *   npm run enrich-scores              # スコア未設定 or あらすじ未設定 or ジャンル未登録の作品
 *   npm run enrich-scores -- 2026      # 2026年に限定
 *   npm run enrich-scores -- 2026 force
 *   npm run enrich-scores -- force     # 全件強制再取得
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

import { fetchAniListInfo } from "../lib/adapters/anilist.ts";
import { fetchMalById } from "../lib/adapters/mal.ts";
import { getAdminClient } from "../lib/supabase/admin.ts";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const args = process.argv.slice(2);
  const force = args.includes("force");
  const year = args.find((a) => /^\d{4}$/.test(a));

  const db = getAdminClient();

  // work_genres に登録済みの work_id セットを取得（ジャンル欠損判定に使う）
  const { data: wgRows, error: wgErr } = await db.from("work_genres").select("work_id");
  if (wgErr) throw wgErr;
  const worksWithGenres = new Set((wgRows ?? []).map((r: any) => r.work_id));

  let q = db
    .from("works")
    .select("id, title, season_year, anilist_score, synopsis")
    .order("popularity", { ascending: false });
  if (year) q = q.eq("season_year", Number(year));
  let works: any[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await q.range(from, from + 999);
    if (error) throw error;
    works.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }

  // force時は全件、通常は「スコア未設定 OR あらすじ未設定 OR ジャンル未登録」のいずれか
  // 人気度の高い作品を優先し（クエリは popularity DESC 済み）、ENRICH_LIMIT 件に上限を設定（タイムアウト防止）
  const limit = Number(process.env.ENRICH_LIMIT) || 300;
  const todo = (force
    ? works
    : works.filter(
        (w) =>
          w.anilist_score == null ||
          w.synopsis == null ||
          !worksWithGenres.has(w.id),
      )).slice(0, limit);
  console.log(`対象 ${todo.length} / ${year ?? "全"} ${works.length} 作品（上限 ${limit} 件、人気度順）\n`);

  let ok = 0;
  for (const w of todo) {
    const ani = await fetchAniListInfo(w.title, w.season_year).catch(() => null);
    let mal = null;
    if (ani?.malId) {
      await sleep(700);
      mal = await fetchMalById(ani.malId).catch(() => null);
    }
    const update: Record<string, unknown> = {
      anilist_score: ani?.score ?? null,
      anilist_popularity: ani?.popularity ?? null,
      mal_id: ani?.malId ?? null,
      mal_score: mal?.score ?? null,
      mal_scored_by: mal?.scoredBy ?? null,
      mal_members: mal?.members ?? null,
    };
    // あらすじ: 現在 null の場合のみ設定（既存テキストを上書きしない）
    if (w.synopsis == null && ani?.description) {
      update.synopsis = ani.description;
    }
    await db.from("works").update(update).eq("id", w.id);

    // ジャンルの upsert（冪等）
    const genres: string[] = ani?.genres ?? [];
    if (genres.length > 0) {
      for (const name of genres) {
        // genres テーブルに upsert（同名は無視）
        const { data: gRow, error: gErr } = await db
          .from("genres")
          .upsert({ name }, { onConflict: "name" })
          .select("id")
          .single();
        if (gErr) {
          // upsert が無視した場合（既存行）は select で取得
          const { data: existing } = await db.from("genres").select("id").eq("name", name).single();
          if (existing) {
            await db
              .from("work_genres")
              .upsert({ work_id: w.id, genre_id: existing.id }, { onConflict: "work_id,genre_id", ignoreDuplicates: true });
          }
        } else if (gRow) {
          await db
            .from("work_genres")
            .upsert({ work_id: w.id, genre_id: gRow.id }, { onConflict: "work_id,genre_id", ignoreDuplicates: true });
        }
      }
    }

    if (ani?.score != null || mal?.score != null) {
      ok++;
      console.log(
        `✓ ${w.title}  AniList:${ani?.score ?? "-"} MAL:${mal?.score ?? "-"} ジャンル:${genres.length}件 あらすじ:${ani?.description ? "あり" : "なし"}`,
      );
    } else {
      console.log(`— ${w.title} (スコア見つからず) ジャンル:${genres.length}件`);
    }
    await sleep(2000); // AniListレート制限に配慮
  }
  console.log(`\n完了: 今回 ${ok} 件にスコアを設定`);
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
