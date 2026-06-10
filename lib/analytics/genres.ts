/**
 * ジャンル動向分析 — work_genres × works を結合してジャンルごとの集計値を返す。
 *
 * データは enrich-scores スクリプト（12時間クーロン）が AniList から取得した
 * genres / work_genres 行が埋まるに従い増加する。
 * 空の場合は [] を返し、UI 側でエンプティステートを表示する。
 */

import { getAdminClient } from "../supabase/admin.ts";
import { mean } from "./studios.ts";
import { memoizeTTL } from "../cache.ts";

export interface GenreInsight {
  genre: string;
  worksCount: number;
  avgPopularity: number; // Annict ウォッチャー数の平均
  avgScore: number | null; // AniList 優先・なければ MAL*10 の平均（スコア付き作品のみ）
  scoredWorks: number; // スコア付き作品数
}

/** AniList 優先スコア（0-100）を解決する。両方 null なら null。*/
function resolveScore(anilistScore: number | null, malScore: number | null): number | null {
  if (anilistScore != null) return anilistScore;
  if (malScore != null) return Math.round(Number(malScore) * 10);
  return null;
}

/**
 * ジャンルごとの統計を返す。worksCount 降順でソート。
 * DB アクセスが失敗した場合は空配列を返す（UI を壊さない）。
 */
async function getGenreInsightsUncached(): Promise<GenreInsight[]> {
  try {
    const db = getAdminClient();

    // work_genres → genres(name) × works(popularity, anilist_score, mal_score)
    // ページネーション（1000件上限超え対策）
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rows: any[] = [];

    for (let from = 0; ; from += 1000) {
      const { data, error } = await db
        .from("work_genres")
        .select("genres(name), works!inner(popularity, anilist_score, mal_score)")
        .range(from, from + 999);
      if (error) throw error;
      rows.push(...(data ?? []));
      if (!data || data.length < 1000) break;
    }

    // ジャンル名ごとに集約
    const map = new Map<
      string,
      { popularities: number[]; scores: number[] }
    >();

    for (const row of rows) {
      const name = row.genres?.name as string | undefined;
      if (!name) continue;
      const w = row.works;
      const score = resolveScore(w.anilist_score ?? null, w.mal_score ?? null);

      if (!map.has(name)) map.set(name, { popularities: [], scores: [] });
      const acc = map.get(name)!;
      acc.popularities.push(w.popularity ?? 0);
      if (score != null) acc.scores.push(score);
    }

    const insights: GenreInsight[] = [];
    for (const [genre, acc] of map) {
      const avgPopRaw = mean(acc.popularities);
      const avgScoreRaw = acc.scores.length > 0 ? mean(acc.scores) : null;
      insights.push({
        genre,
        worksCount: acc.popularities.length,
        avgPopularity: isFinite(avgPopRaw) ? Math.round(avgPopRaw) : 0,
        avgScore: avgScoreRaw != null && isFinite(avgScoreRaw)
          ? Math.round(avgScoreRaw * 10) / 10
          : null,
        scoredWorks: acc.scores.length,
      });
    }

    // worksCount 降順、同点は avgScore 降順
    insights.sort(
      (a, b) =>
        b.worksCount - a.worksCount ||
        (b.avgScore ?? 0) - (a.avgScore ?? 0),
    );

    return insights;
  } catch {
    return [];
  }
}

/**
 * ジャンル動向（30分メモ化）。エクスポート名・挙動は従来どおり。
 * work_genres を全ページ走査する重い集計をキャッシュする。
 */
export const getGenreInsights = memoizeTTL(getGenreInsightsUncached, () => "genres", 1800000);
