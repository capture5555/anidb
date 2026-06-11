/**
 * リアクションの「指紋（fingerprint）」分析。
 * - detectSpikes: 分単位コメント数の z-score から外れ値（神シーン）を検出する純粋関数
 * - radarPoints: レーダーチャート用の SVG polygon points を生成する純粋関数
 * - getCohortReactionAverage: クール全体（収集済み全作品）の平均リアクション構成比を集計
 *
 * 純粋関数（detectSpikes / radarPoints）は DB に依存せずテスト可能。
 */
import { getAdminClient } from "../supabase/admin.ts";
import type { ReactionCategory } from "./commentAnalysis.ts";
import { memoizeTTL } from "../cache.ts";
import { fromSnapshotOrLive } from "./snapshots.ts";

const chunk = <T,>(arr: T[], size: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
};

const CATEGORIES: ReactionCategory[] = ["laugh", "hype", "cry", "surprise", "sakuga", "scream"];

// ---------------------------------------------------------------- 純粋関数: スパイク検出

export interface Spike {
  index: number;
  z: number;
}

/**
 * 数列の中で z-score（母集団標準偏差）が k 以上の点を返す純粋関数。
 * z = (x - mean) / std。std==0 または 3点未満なら空配列。
 */
export function detectSpikes(totals: number[], k = 2): Spike[] {
  if (totals.length < 3) return [];
  const n = totals.length;
  const mean = totals.reduce((a, b) => a + b, 0) / n;
  const variance = totals.reduce((a, b) => a + (b - mean) * (b - mean), 0) / n;
  const std = Math.sqrt(variance);
  if (std === 0) return [];
  const out: Spike[] = [];
  for (let i = 0; i < n; i++) {
    const z = (totals[i] - mean) / std;
    if (z >= k) out.push({ index: i, z });
  }
  return out;
}

// ---------------------------------------------------------------- 純粋関数: レーダー座標

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

/**
 * N 軸のレーダーチャートの polygon points 文字列を返す純粋関数。
 * 軸は真上（−90°）から時計回りに等間隔。各頂点の半径 = r * clamp(v, 0, 1)。
 */
export function radarPoints(values01: number[], cx: number, cy: number, r: number): string {
  const n = values01.length;
  return values01
    .map((v, i) => {
      const angle = -Math.PI / 2 + (2 * Math.PI * i) / n;
      const radius = r * clamp01(v);
      const x = cx + radius * Math.cos(angle);
      const y = cy + radius * Math.sin(angle);
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ");
}

// ---------------------------------------------------------------- クール平均リアクション

type CatShares = Record<ReactionCategory, number>;
const zeroShares = (): CatShares => ({ laugh: 0, hype: 0, cry: 0, surprise: 0, sakuga: 0, scream: 0 });

/**
 * 収集済み全番組のリアクションを作品単位に集計し、各作品を構成比（6カテゴリ合計=1）に
 * 正規化したうえで、作品ごと等重みで平均した「クール平均構成比」を返す。
 * basis = 集計対象の作品数。エラー時は全0・basis=0。
 *
 * 集計パターンは viewing.ts の getReactionRatios を踏襲。
 */
export async function getCohortReactionAverageUncached(): Promise<{ shares: CatShares; basis: number }> {
  try {
    const db = getAdminClient();

    // 収集済み番組（ページネーションで全件取得）
    const allLogs: { program_id: string; comment_count: number }[] = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await db
        .from("analytics_collection_log")
        .select("program_id, comment_count")
        .eq("status", "collected")
        .gt("comment_count", 0)
        .range(from, from + 999);
      if (error) break;
      allLogs.push(...(data ?? []));
      if (!data || data.length < 1000) break;
    }
    if (allLogs.length === 0) return { shares: zeroShares(), basis: 0 };
    const programIds = allLogs.map((l) => l.program_id);

    // 番組 → 作品
    const workByProgram = new Map<string, string>();
    for (const ids of chunk(programIds, 150)) {
      const { data } = await db.from("programs").select("id, work_id").in("id", ids);
      for (const p of data ?? []) workByProgram.set(p.id, p.work_id);
    }

    // リアクション行を全ページ読み、作品単位にカテゴリ別合計
    const sumsByWork = new Map<string, CatShares>();
    for (let offset = 0; ; offset += 1000) {
      const { data, error } = await db
        .from("analytics_minute_reactions")
        .select("program_id, category, count")
        .range(offset, offset + 999);
      if (error) throw error;
      for (const r of data ?? []) {
        const workId = workByProgram.get(r.program_id);
        if (!workId) continue;
        const cat = r.category as ReactionCategory;
        if (!CATEGORIES.includes(cat)) continue;
        let s = sumsByWork.get(workId);
        if (!s) {
          s = zeroShares();
          sumsByWork.set(workId, s);
        }
        s[cat] += r.count;
      }
      if (!data || data.length < 1000) break;
    }

    // 各作品を構成比に正規化 → 作品ごと等重みで平均
    const accum = zeroShares();
    let basis = 0;
    for (const sums of sumsByWork.values()) {
      const total = CATEGORIES.reduce((a, c) => a + sums[c], 0);
      if (total <= 0) continue;
      for (const c of CATEGORIES) accum[c] += sums[c] / total;
      basis += 1;
    }
    if (basis === 0) return { shares: zeroShares(), basis: 0 };

    const shares = zeroShares();
    for (const c of CATEGORIES) shares[c] = accum[c] / basis;
    return { shares, basis };
  } catch {
    return { shares: zeroShares(), basis: 0 };
  }
}

/** クール平均リアクション構成比の LIVE 計算（30分メモ化）。 */
const getCohortReactionAverageLive = memoizeTTL(
  getCohortReactionAverageUncached,
  () => "cohort",
  1800000,
);

/**
 * クール平均リアクション構成比。エクスポート名・挙動は従来どおり。
 * まず事前計算スナップショット("cohort_reaction")を読み、無ければ LIVE 計算へフォールバック。
 */
export function getCohortReactionAverage(): Promise<{ shares: CatShares; basis: number }> {
  return fromSnapshotOrLive("cohort_reaction", getCohortReactionAverageLive);
}
