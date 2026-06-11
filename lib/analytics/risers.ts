/**
 * 急上昇アラート（直近の伸び）— 広報が朝にチェックする用途。
 *
 * getJikkyoRetentionSeries(100) の結果を使い、各作品で
 *   最新話の実況コメント数 と「それ以前の話の平均コメント数」を比較し
 *   deltaPct = (latest - priorAvg) / priorAvg * 100 を算出。
 *
 * 判定条件（ノイズ除去）:
 *   - 3話以上のデータがある作品のみ対象（最新話 + 比較対象2話以上）
 *   - priorAvg >= 100（母数が小さすぎる作品を除外）
 *   - latestComments >= 200（絶対量が少ない作品を除外）
 *   - deltaPct >= 30（30%以上の伸び）
 *
 * 返り値は deltaPct 降順。
 */
import { getJikkyoRetentionSeries, type RetentionResult } from "./viewing.ts";
import { memoizeTTL } from "../cache.ts";
import { fromSnapshotOrLive } from "./snapshots.ts";

export interface RiserRow {
  workId: string;
  title: string;
  posterUrl: string | null;
  /** 最新話のラベル（例: 「第5話」） */
  latestLabel: string | null;
  /** 最新話の実況コメント数 */
  latestComments: number;
  /** 最新話を除く直前話の平均コメント数（小数切り捨て） */
  priorAvg: number;
  /** (latestComments - priorAvg) / priorAvg * 100、小数第1位に丸め */
  deltaPct: number;
}

/** 急上昇判定のしきい値 */
const MIN_PRIOR_AVG = 100; // 前話までの平均がこれ未満はノイズ
const MIN_LATEST = 200; // 最新話のコメント数がこれ未満は除外
const MIN_DELTA_PCT = 30; // 30%以上の伸びのみ急上昇

/** 素の計算（スナップショット/メモ化を経由しない）。 */
export async function getRisersUncached(limit = 10): Promise<RiserRow[]> {
  try {
    const fallback: RetentionResult = { snapshotDate: null, series: [] };
    const jikkyoResult = await getJikkyoRetentionSeries(100).catch(() => fallback);

    const series = jikkyoResult.series ?? [];
    const candidates: RiserRow[] = [];

    for (const s of series) {
      const points = s.points;
      // 3話以上あるものだけ対象（最新1話 + 比較対象2話以上）
      if (points.length < 3) continue;

      const latest = points[points.length - 1];
      const priorPoints = points.slice(0, points.length - 1);

      const priorAvg =
        priorPoints.reduce((acc, p) => acc + p.records, 0) / priorPoints.length;

      // ノイズ除去
      if (priorAvg < MIN_PRIOR_AVG) continue;
      if (latest.records < MIN_LATEST) continue;

      const deltaPct = ((latest.records - priorAvg) / priorAvg) * 100;
      if (deltaPct < MIN_DELTA_PCT) continue;

      candidates.push({
        workId: s.workId,
        title: s.title,
        posterUrl: s.posterUrl,
        latestLabel: latest.numberText,
        latestComments: latest.records,
        priorAvg: Math.round(priorAvg),
        deltaPct: Math.round(deltaPct * 10) / 10,
      });
    }

    // deltaPct 降順
    candidates.sort((a, b) => b.deltaPct - a.deltaPct);
    return candidates.slice(0, limit);
  } catch {
    return [];
  }
}

/** 30分メモ化した LIVE 計算。 */
const getRisersMemo = memoizeTTL(
  getRisersUncached,
  (limit = 10) => `risers:${limit}`,
  30 * 60 * 1000,
);

/**
 * 急上昇アラート。
 * デフォルト引数（limit=10）のときは事前計算スナップショット("risers")を読み、
 * 無ければ LIVE 計算へフォールバック。非デフォルト引数のときは LIVE 計算する。
 * いずれの層も欠落時は [] に落ちるため防御的。
 */
export function getRisers(limit = 10): Promise<RiserRow[]> {
  if (limit !== 10) return getRisersMemo(limit);
  return fromSnapshotOrLive("risers", () => getRisersMemo(limit)).catch(() => []);
}
