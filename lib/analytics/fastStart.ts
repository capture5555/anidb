/**
 * 初速スコア（立ち上がりの強さ）— 宣伝・製作委員会向け。
 *
 * 各作品について:
 *   - 実況初速 = 第1話の実況コメント数（getJikkyoRetentionSeries の points[0].records）
 *   - X初速    = 最新Xバズ volume（0〜5）（getCohortXBuzz の volume、代理指標）
 * をコホート内パーセンタイル（0〜100）化し、
 *   初速スコア = 実況初速% × 0.6 + X初速% × 0.4
 * で合成する。X初速が欠測の場合は実況のみで再正規化（実況% × 1.0）。
 * 第1話データが無い作品は除外。
 */
import { getJikkyoRetentionSeries } from "./viewing.ts";
import { getCohortXBuzz, type CohortXBuzz } from "./xbuzz.ts";
import { percentile } from "./people.ts";
import { memoizeTTL } from "../cache.ts";
import { fromSnapshotOrLive } from "./snapshots.ts";

export interface FastStartRow {
  workId: string;
  title: string;
  posterUrl: string | null;
  /** 合成初速スコア 0〜100 */
  score: number;
  /** 実況初速のコホート内パーセンタイル 0〜100 */
  jikkyoPctl: number;
  /** X初速のコホート内パーセンタイル 0〜100（欠測時は null） */
  xPctl: number | null;
  /** 第1話の実況コメント数 */
  ep1Comments: number;
}

/**
 * 値の配列から各値のコホート内パーセンタイル（0〜100）を返す純関数。
 * 値が同じでも要素ごとに独立して計算し、0件は NaN を返す。
 */
function toPercentiles(values: number[]): number[] {
  if (values.length === 0) return [];
  const sorted = [...values].sort((a, b) => a - b);
  return values.map((v) => {
    // v 未満の要素数と v と同値の要素数の中間 → rank-based percentile
    const below = sorted.filter((x) => x < v).length;
    const equal = sorted.filter((x) => x === v).length;
    if (sorted.length === 1) return 100;
    return Math.round(((below + (equal - 1) / 2) / (sorted.length - 1)) * 100);
  });
}

/** 素の計算（スナップショット/メモ化を経由しない）。 */
export async function getFastStartUncached(limit = 30): Promise<FastStartRow[]> {
  try {
    const [jikkyoResult, xBuzzRows] = await Promise.all([
      getJikkyoRetentionSeries(100).catch(() => ({ snapshotDate: null, series: [] })),
      getCohortXBuzz(100).catch((): CohortXBuzz[] => []),
    ]);

    const series = jikkyoResult.series ?? [];

    // 第1話のデータがある作品だけ抽出
    const candidates: {
      workId: string;
      title: string;
      posterUrl: string | null;
      ep1Comments: number;
    }[] = [];

    for (const s of series) {
      const ep1 = s.points[0];
      if (!ep1 || ep1.records <= 0) continue;
      candidates.push({
        workId: s.workId,
        title: s.title,
        posterUrl: s.posterUrl,
        ep1Comments: ep1.records,
      });
    }

    if (candidates.length === 0) return [];

    // X初速マップ（workId → volume）
    const xVolMap = new Map<string, number>();
    for (const x of xBuzzRows) {
      xVolMap.set(x.workId, x.volume);
    }

    // 実況初速のパーセンタイル化
    const jikkyoValues = candidates.map((c) => c.ep1Comments);
    const jikkyoPctls = toPercentiles(jikkyoValues);

    // X初速のパーセンタイル化（コホート内でデータがある作品のみ）
    const xCandidates = candidates.map((c) => ({
      workId: c.workId,
      volume: xVolMap.get(c.workId) ?? null,
    }));
    const xWithData = xCandidates.filter((x) => x.volume != null) as { workId: string; volume: number }[];
    const xValues = xWithData.map((x) => x.volume);
    const xPctls = toPercentiles(xValues);
    const xPctlMap = new Map<string, number>();
    xWithData.forEach((x, i) => xPctlMap.set(x.workId, xPctls[i]));

    // スコア合成
    const rows: FastStartRow[] = candidates.map((c, i) => {
      const jPctl = jikkyoPctls[i];
      const xPctl = xPctlMap.has(c.workId) ? xPctlMap.get(c.workId)! : null;

      let score: number;
      if (xPctl != null) {
        score = jPctl * 0.6 + xPctl * 0.4;
      } else {
        // X欠測: 実況のみで再正規化
        score = jPctl * 1.0;
      }

      return {
        workId: c.workId,
        title: c.title,
        posterUrl: c.posterUrl,
        score: Math.round(score * 10) / 10,
        jikkyoPctl: jPctl,
        xPctl: xPctl,
        ep1Comments: c.ep1Comments,
      };
    });

    // score 降順
    rows.sort((a, b) => b.score - a.score);
    return rows.slice(0, limit);
  } catch {
    return [];
  }
}

/** 30分メモ化した LIVE 計算。 */
const getFastStartMemo = memoizeTTL(
  getFastStartUncached,
  (limit = 30) => `fast_start:${limit}`,
  30 * 60 * 1000,
);

/**
 * 初速スコアランキング。
 * デフォルト引数（limit=30）のときは事前計算スナップショット("fast_start")を読み、
 * 無ければ LIVE 計算へフォールバック。非デフォルト引数のときは LIVE 計算する。
 * いずれの層も欠落時は [] に落ちるため防御的。
 */
export function getFastStart(limit = 30): Promise<FastStartRow[]> {
  if (limit !== 30) return getFastStartMemo(limit);
  return fromSnapshotOrLive("fast_start", () => getFastStartMemo(limit)).catch(() => []);
}
