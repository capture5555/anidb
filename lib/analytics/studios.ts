/**
 * スタジオ・スコアカード — 制作会社ごとの意思決定グレード指標を算出する。
 *
 * スタジオの同定方法は v_studio_stats / getStudioStats と完全に一致させる:
 *   work_staff.role = 'アニメーション制作' かつ person_name が空でない行の person_name を使う。
 *
 * 統計ヘルパーは純関数としてエクスポートし、DBなしで単体テスト可能にする。
 */

import { getAdminClient } from "../supabase/admin.ts";
import { memoizeTTL } from "../cache.ts";

/* ================================================================
   純関数（単体テスト可）
   ================================================================ */

/** 数値配列の中央値（空配列は NaN）*/
export function median(nums: number[]): number {
  if (nums.length === 0) return NaN;
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/** 数値配列の算術平均（空配列は NaN）*/
export function mean(nums: number[]): number {
  if (nums.length === 0) return NaN;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

/**
 * 変動係数 CV = 標準偏差 / 平均。
 * 0 以上。平均が 0 またはサンプルが 1 未満のときは NaN。
 */
export function coefficientOfVariation(nums: number[]): number {
  if (nums.length < 2) return NaN;
  const m = mean(nums);
  if (m === 0) return NaN;
  const variance = nums.reduce((a, b) => a + (b - m) ** 2, 0) / nums.length;
  return Math.sqrt(variance) / m;
}

/**
 * CV から一貫性スコア (0-100) を求める。
 * consistency = round(clamp(100 * (1 - CV), 0, 100))
 */
export function consistencyFromCv(cv: number): number {
  if (!isFinite(cv)) return NaN;
  return Math.round(Math.max(0, Math.min(100, 100 * (1 - cv))));
}

/**
 * 打率 — スタジオのスコア付き作品のうち、同クール中央値以上の割合。
 * @param studioScores  score / seasonMedian のペアの配列（scored works のみ）
 */
export function battingAverage(studioScores: { score: number; seasonMedian: number }[]): number {
  if (studioScores.length === 0) return NaN;
  const hits = studioScores.filter((s) => s.score >= s.seasonMedian).length;
  return Math.round((hits / studioScores.length) * 1000) / 1000;
}

/* ================================================================
   DB アクセス層
   ================================================================ */

export interface YearAvgScore {
  year: number;
  avgScore: number;
}

export interface StudioScorecard {
  studio: string;
  worksCount: number;
  scoredWorks: number;
  avgScore: number;
  consistency: number | null; // <2 スコア付き作品の場合は null
  battingAverage: number; // 0..1 (round 3)
  avgPopularity: number;
  yearTrend: YearAvgScore[]; // 直近4年分、昇順
}

/** ワーク1行 — スタジオ集計に必要な列だけ */
interface WorkRow {
  id: string;
  season_year: number | null;
  season_name: string | null;
  popularity: number | null;
  anilist_score: number | null;
  mal_score: number | null; // numeric → number に変換
}

/** work_staff + works の結合行 */
interface StaffWorkRow {
  person_name: string;
  work_id: string;
  works: WorkRow;
}

/** スコア（AniList 優先、なければ MAL*10）を求める。両方なければ null。*/
function resolveScore(w: WorkRow): number | null {
  if (w.anilist_score != null) return w.anilist_score;
  if (w.mal_score != null) return Math.round(Number(w.mal_score) * 10);
  return null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function paginate(build: (from: number) => any): Promise<StaffWorkRow[]> {
  const out: StaffWorkRow[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await build(from).range(from, from + 999);
    if (error) throw error;
    out.push(...((data ?? []) as StaffWorkRow[]));
    if (!data || data.length < 1000) break;
  }
  return out;
}

/**
 * スタジオ・スコアカードを返す。
 * スタジオの同定は v_studio_stats と同じ:
 *   work_staff.role = 'アニメーション制作', person_name <> ''
 *
 * @param opts.minScoredWorks ノイズフロア（デフォルト 3）
 * @param opts.limit          上位N件（avgScore 降順）。デフォルト 20。
 */
async function getStudioScorecardsUncached(opts?: {
  minScoredWorks?: number;
  limit?: number;
}): Promise<StudioScorecard[]> {
  const minScoredWorks = opts?.minScoredWorks ?? 3;
  const limit = opts?.limit ?? 20;

  const db = getAdminClient();

  // 全期間の work_staff × works — v_studio_stats と同一の role / person_name 条件
  const rows = await paginate((from) =>
    db
      .from("work_staff")
      .select(
        "person_name, work_id, works!inner(id, season_year, season_name, popularity, anilist_score, mal_score)",
      )
      .eq("role", "アニメーション制作")
      .not("person_name", "is", null)
      .neq("person_name", ""),
  );

  /* ----------------------------------------------------------------
     1. シーズン別の全作品スコア中央値を事前に計算する
        (batting average の分母となる cohort median)
     ---------------------------------------------------------------- */
  // 全作品のスコアを season_year+season_name キーでグループ化
  // （people.ts と同様に work_id で重複排除してから集計。共作で同一作品が
  //  複数の制作クレジット行に出ても中央値を歪めないようにする）
  const scoresBySeason = new Map<string, number[]>();
  const seenSeasonWork = new Set<string>();
  for (const row of rows) {
    const w = row.works as WorkRow;
    if (seenSeasonWork.has(w.id)) continue;
    seenSeasonWork.add(w.id);
    const score = resolveScore(w);
    if (score == null || !w.season_year || !w.season_name) continue;
    const key = `${w.season_year}|${w.season_name}`;
    if (!scoresBySeason.has(key)) scoresBySeason.set(key, []);
    scoresBySeason.get(key)!.push(score);
  }
  // シーズンキー → 中央値
  const seasonMedianMap = new Map<string, number>();
  for (const [key, scores] of scoresBySeason) {
    seasonMedianMap.set(key, median(scores));
  }

  /* ----------------------------------------------------------------
     2. スタジオごとに作品を集約（work_id で重複排除）
     ---------------------------------------------------------------- */
  interface StudioAccum {
    works: Map<string, WorkRow>; // work_id → WorkRow
  }
  const studioMap = new Map<string, StudioAccum>();

  for (const row of rows) {
    const name = row.person_name;
    if (!name) continue;
    if (!studioMap.has(name)) studioMap.set(name, { works: new Map() });
    const acc = studioMap.get(name)!;
    if (!acc.works.has(row.work_id)) {
      acc.works.set(row.work_id, row.works as WorkRow);
    }
  }

  /* ----------------------------------------------------------------
     3. スコアカードを計算
     ---------------------------------------------------------------- */
  const scorecards: StudioScorecard[] = [];

  for (const [studio, acc] of studioMap) {
    const allWorks = [...acc.works.values()];
    const worksCount = allWorks.length;

    // スコア付き作品の抽出
    const scoredWorkPairs: { work: WorkRow; score: number }[] = [];
    for (const w of allWorks) {
      const score = resolveScore(w);
      if (score != null) scoredWorkPairs.push({ work: w, score });
    }
    const scoredWorks = scoredWorkPairs.length;

    // ノイズフロア
    if (scoredWorks < minScoredWorks) continue;

    const scores = scoredWorkPairs.map((p) => p.score);

    // 平均スコア
    const avgScore = mean(scores);

    // 一貫性
    let consistency: number | null = null;
    if (scoredWorks >= 2) {
      const cv = coefficientOfVariation(scores);
      consistency = isFinite(cv) ? consistencyFromCv(cv) : null;
    }

    // 打率 — scored 作品ごとに同クール中央値と比較
    const studioScoredPairs: { score: number; seasonMedian: number }[] = [];
    for (const { work, score } of scoredWorkPairs) {
      if (!work.season_year || !work.season_name) continue;
      const key = `${work.season_year}|${work.season_name}`;
      const med = seasonMedianMap.get(key);
      if (med == null) continue;
      studioScoredPairs.push({ score, seasonMedian: med });
    }
    const ba =
      studioScoredPairs.length > 0 ? battingAverage(studioScoredPairs) : NaN;

    // 平均人気度 — v_studio_stats の avg_popularity と同一ロジック
    const popSum = allWorks.reduce((s, w) => s + (w.popularity ?? 0), 0);
    const avgPopularity = Math.round(popSum / worksCount);

    // 年別トレンド — スコア付き作品を season_year でグループ化 (直近4年)
    const scoresByYear = new Map<number, number[]>();
    for (const { work, score } of scoredWorkPairs) {
      if (!work.season_year) continue;
      if (!scoresByYear.has(work.season_year)) scoresByYear.set(work.season_year, []);
      scoresByYear.get(work.season_year)!.push(score);
    }
    const allYears = [...scoresByYear.keys()].sort((a, b) => a - b);
    const recentYears = allYears.slice(-4);
    const yearTrend: YearAvgScore[] = recentYears.map((year) => ({
      year,
      avgScore: Math.round(mean(scoresByYear.get(year)!) * 10) / 10,
    }));

    scorecards.push({
      studio,
      worksCount,
      scoredWorks,
      avgScore: Math.round(avgScore * 10) / 10,
      consistency,
      battingAverage: isNaN(ba) ? 0 : ba,
      avgPopularity,
      yearTrend,
    });
  }

  /* ----------------------------------------------------------------
     4. avgScore 降順、同点は worksCount 降順でソートして上位 N 件
     ---------------------------------------------------------------- */
  scorecards.sort(
    (a, b) => b.avgScore - a.avgScore || b.worksCount - a.worksCount,
  );

  return scorecards.slice(0, limit);
}

/**
 * スタジオ・スコアカード（opts 単位で30分メモ化）。エクスポート名・挙動は従来どおり。
 * 全期間の work_staff × works を走査する重い集計をキャッシュする。
 */
export const getStudioScorecards = memoizeTTL(
  getStudioScorecardsUncached,
  (opts) => `studio:${opts?.minScoredWorks ?? 3}:${opts?.limit ?? 20}`,
  1800000,
);
