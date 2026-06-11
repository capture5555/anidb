/**
 * 作品比較モード用のデータ集約ヘルパー。
 *
 * 複数作品 ID について各種 KPI を並列取得し、比較テーブル用のデータ構造に整形する。
 * すべて防御的: 取得失敗の指標は null として扱い、UI側で「—」表示にする。
 */
import { getWorkAnalysis } from "./viewing.ts";
import { getWorkXBuzz } from "./xbuzz.ts";
import { getOverallRanking, type OverallRankingRow } from "./overallRanking.ts";
import { getFastStart, type FastStartRow } from "./fastStart.ts";
import { getWorkCohortPosition } from "./scorecard.ts";
import { getAdminClient } from "../supabase/admin.ts";
import { seasonOf } from "../season.ts";

/** 1 作品の比較指標をまとめた構造体 */
export interface WorkCompareData {
  workId: string;
  title: string;
  posterUrl: string | null;
  /** ジャンル（なければ空配列） */
  genres: string[];
  /** 総合スコア 0-100 */
  overallScore: number | null;
  /** 総合スコア クール内順位 (1-indexed) */
  overallRank: number | null;
  /** 総合スコア母数 */
  overallTotal: number | null;
  /** 初速スコア 0-100 */
  fastStartScore: number | null;
  /** 初速スコア クール内順位 (1-indexed) */
  fastStartRank: number | null;
  /** 初速スコア母数 */
  fastStartTotal: number | null;
  /** Xバズ volume 0-5 */
  xBuzzVolume: number | null;
  /** Xバズ sentiment 文字列 */
  xBuzzSentiment: string | null;
  /** 最新話満足度 % */
  latestSatisfaction: number | null;
  /** 実況コメント総数 */
  totalComments: number | null;
  /** クール内偏差値 */
  cohortDeviation: number | null;
  /** 上位X% (cohort 内) */
  cohortPercentile: number | null;
  /** cohort サイズ */
  cohortSize: number | null;
}

/**
 * 今期の放送中TV作品一覧（作品追加 select 用）。
 * popularity 降順・最大 200 件。失敗は []。
 */
export interface SelectableWork {
  id: string;
  title: string;
  posterUrl: string | null;
}

export async function getCurrentSeasonWorks(): Promise<SelectableWork[]> {
  try {
    const db = getAdminClient();
    const { year, season } = seasonOf(new Date());
    const { data, error } = await db
      .from("works")
      .select("id, title, poster_url, key_visual_url")
      .eq("season_year", year)
      .eq("season_name", season)
      .or("media.neq.movie,media.is.null")
      .order("popularity", { ascending: false })
      .limit(200);
    if (error || !data) return [];
    return data.map((w) => ({
      id: w.id as string,
      title: w.title as string,
      posterUrl: (w.poster_url ?? w.key_visual_url ?? null) as string | null,
    }));
  } catch {
    return [];
  }
}

/**
 * 単一作品のジャンルを取得する。失敗は []。
 */
async function getWorkGenres(workId: string): Promise<string[]> {
  try {
    const db = getAdminClient();
    const { data, error } = await db
      .from("work_genres")
      .select("genres(name)")
      .eq("work_id", workId);
    if (error || !data) return [];
    return data
      .map((row: any) => row.genres?.name as string | undefined)
      .filter((n): n is string => Boolean(n));
  } catch {
    return [];
  }
}

/**
 * 複数作品の比較データを並列取得する。
 * 指定 id が存在しない / 取得失敗の場合は各フィールドが null になる（エラーは投げない）。
 */
export async function getWorksCompareData(ids: string[]): Promise<WorkCompareData[]> {
  if (ids.length === 0) return [];

  // 全作品共通のランキングは一度だけ取得
  const [overallRanking, fastStartRanking] = await Promise.all([
    getOverallRanking().catch((): OverallRankingRow[] => []),
    getFastStart(200).catch((): FastStartRow[] => []),
  ]);

  const overallTotal = overallRanking.length > 0 ? overallRanking.length : null;
  const fastStartTotal = fastStartRanking.length > 0 ? fastStartRanking.length : null;

  // 各作品のデータを並列取得
  const results = await Promise.all(
    ids.map(async (id): Promise<WorkCompareData> => {
      const [analysis, xbuzz, cohort, genres] = await Promise.all([
        getWorkAnalysis(id).catch(() => null),
        getWorkXBuzz(id).catch(() => null),
        getWorkCohortPosition(id).catch(() => null),
        getWorkGenres(id),
      ]);

      // title / posterUrl のフォールバック: ranking から探す
      const overallRow = overallRanking.find((r) => r.workId === id) ?? null;
      const fastStartRow = fastStartRanking.find((r) => r.workId === id) ?? null;

      const title =
        analysis?.title ?? overallRow?.title ?? fastStartRow?.title ?? id;
      const posterUrl =
        analysis?.posterUrl ?? overallRow?.posterUrl ?? fastStartRow?.posterUrl ?? null;

      // ランキング順位
      const overallRank = overallRow != null ? overallRanking.indexOf(overallRow) + 1 : null;
      const fastStartRank = fastStartRow != null ? fastStartRanking.indexOf(fastStartRow) + 1 : null;

      // 最新話満足度
      const satPoints = analysis?.satisfactionPoints ?? [];
      const latestSat = satPoints.length > 0 ? satPoints[satPoints.length - 1] : null;

      // 実況コメント総数
      const totalComments =
        analysis != null && analysis.episodes.length > 0
          ? analysis.episodes.reduce((s, ep) => s + ep.totalComments, 0)
          : null;

      return {
        workId: id,
        title,
        posterUrl,
        genres,
        overallScore: overallRow?.score ?? null,
        overallRank,
        overallTotal,
        fastStartScore: fastStartRow?.score ?? null,
        fastStartRank,
        fastStartTotal,
        xBuzzVolume: xbuzz?.volume ?? null,
        xBuzzSentiment: xbuzz?.sentiment ?? null,
        latestSatisfaction: latestSat?.rate ?? null,
        totalComments: totalComments != null && totalComments > 0 ? totalComments : null,
        cohortDeviation: cohort?.work.overall ?? null,
        cohortPercentile: cohort?.work.overallPercentile ?? null,
        cohortSize: cohort?.cohortSize ?? null,
      };
    }),
  );

  return results;
}
