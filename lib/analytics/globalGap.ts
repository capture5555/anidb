/**
 * 国内 × 海外 人気乖離インジケーター。
 *
 * 今期（seasonOf）の非movie作品について、
 *   国内スコア = popularity（Annict watchers）のコホート内パーセンタイル(0〜100)
 *   海外スコア = anilist_popularity（主）または mal_members（フォールバック）のコホート内パーセンタイル(0〜100)
 *   gap        = 海外スコア − 国内スコア（+で海外先行、−で国内先行）
 *
 * 両方の元データが欠損している作品は除外。
 * kindは |gap|>=20 で lead 判定（それ未満は "balanced"）。
 * |gap| 降順で返す。
 *
 * 製作委員会・ライセンス担当向け: 海外配信・ライセンス強化の余地を見つける。
 */

import { getAdminClient } from "../supabase/admin.ts";
import { seasonOf } from "../season.ts";
import { memoizeTTL } from "../cache.ts";
import { fromSnapshotOrLive } from "./snapshots.ts";

/* ----------------------------------------------------------------- 型 */

export type GlobalGapKind = "overseas_lead" | "domestic_lead" | "balanced";

export interface GlobalGapRow {
  workId: string;
  title: string;
  posterUrl: string | null;
  /** 国内人気のコホート内パーセンタイル (0〜100) */
  domestic: number;
  /** 海外人気のコホート内パーセンタイル (0〜100) */
  overseas: number;
  /** gap = overseas − domestic。+で海外先行、−で国内先行 */
  gap: number;
  kind: GlobalGapKind;
}

/* ----------------------------------------------------------------- 純関数 */

/**
 * 値の配列からコホート内パーセンタイルを計算して返す写像を構築する。
 * 最大値が100、最小値が0になるよう min-max 正規化したうえで四捨五入。
 * 同値は同じパーセンタイルになる（スパイクを丸め込まないため min-max を使う）。
 * 全ての値が同一の場合は全て 50 を返す。
 *
 * @param pairs id と生値のペア配列
 * @returns id → パーセンタイル(0〜100) の Map
 */
export function buildCohortPercentileMap(
  pairs: { id: string; value: number }[],
): Map<string, number> {
  const result = new Map<string, number>();
  if (pairs.length === 0) return result;

  const values = pairs.map((p) => p.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min;

  for (const { id, value } of pairs) {
    const pct = range === 0 ? 50 : Math.round(((value - min) / range) * 100);
    result.set(id, pct);
  }
  return result;
}

/**
 * gap から kind を判定する。
 * |gap| >= 20 を "lead" 判定、それ未満を "balanced"。
 */
export function kindFromGap(gap: number): GlobalGapKind {
  if (gap >= 20) return "overseas_lead";
  if (gap <= -20) return "domestic_lead";
  return "balanced";
}

/* ----------------------------------------------------------------- DB行型 */

interface GapWorkRow {
  id: string;
  title: string;
  poster_url: string | null;
  key_visual_url: string | null;
  popularity: number | null;
  anilist_popularity: number | null;
  mal_members: number | null;
}

const GAP_COLUMNS =
  "id, title, poster_url, key_visual_url, popularity, anilist_popularity, mal_members";

/* ----------------------------------------------------------------- LIVE 計算 */

/**
 * 国内×海外 人気乖離の LIVE 計算（スナップショット/メモ化を経由しない）。
 * compute-snapshots から呼ぶ。
 *
 * @param limit 返す件数（|gap| 降順または overseas 降順）。デフォルト 30。
 */
export async function getGlobalGapUncached(limit = 30): Promise<GlobalGapRow[]> {
  const db = getAdminClient();
  const { year, season } = seasonOf(new Date());

  const { data: works } = await db
    .from("works")
    .select(GAP_COLUMNS)
    .eq("season_year", year)
    .eq("season_name", season)
    .or("media.neq.movie,media.is.null");

  const rows = (works ?? []) as GapWorkRow[];
  return buildGlobalGap(rows, limit);
}

/**
 * 与えられた作品行からギャップ行を構築する（DBアクセスなし・純粋計算）。
 * テスト・スナップショット両方から呼べる。
 */
export function buildGlobalGap(rows: GapWorkRow[], limit: number): GlobalGapRow[] {
  // 国内: popularity > 0 の作品のみ
  const withDomestic = rows.filter((w) => (w.popularity ?? 0) > 0);

  // 海外: anilist_popularity があれば優先、なければ mal_members
  const withOverseas = rows.filter(
    (w) => (w.anilist_popularity ?? 0) > 0 || (w.mal_members ?? 0) > 0,
  );

  // 両方ある作品
  const domesticIds = new Set(withDomestic.map((w) => w.id));
  const overseasIds = new Set(withOverseas.map((w) => w.id));
  const eligible = rows.filter((w) => domesticIds.has(w.id) && overseasIds.has(w.id));

  if (eligible.length === 0) return [];

  // 国内パーセンタイル（コホート内、popularity ベース）
  const domesticPctMap = buildCohortPercentileMap(
    eligible.map((w) => ({ id: w.id, value: w.popularity! })),
  );

  // 海外パーセンタイル（コホート内、anilist_popularity 優先・フォールバック mal_members）
  const overseasPctMap = buildCohortPercentileMap(
    eligible.map((w) => ({
      id: w.id,
      value: (w.anilist_popularity ?? 0) > 0 ? w.anilist_popularity! : w.mal_members!,
    })),
  );

  const result: GlobalGapRow[] = eligible.map((w) => {
    const domestic = domesticPctMap.get(w.id) ?? 50;
    const overseas = overseasPctMap.get(w.id) ?? 50;
    const gap = overseas - domestic;
    return {
      workId: w.id,
      title: w.title,
      posterUrl: w.poster_url ?? w.key_visual_url ?? null,
      domestic,
      overseas,
      gap,
      kind: kindFromGap(gap),
    };
  });

  // |gap| 降順でソート（同率なら overseas 降順）
  result.sort((a, b) => {
    const diff = Math.abs(b.gap) - Math.abs(a.gap);
    if (diff !== 0) return diff;
    return b.overseas - a.overseas;
  });

  return result.slice(0, limit);
}

/* ----------------------------------------------------------------- メモ化 + スナップショット */

/** LIVE 計算（30分メモ化）。スナップショット欠如時のフォールバック。 */
const getGlobalGapLive = memoizeTTL(
  () => getGlobalGapUncached(30),
  () => "global_gap",
  1800000,
);

/**
 * 国内×海外 人気乖離ランキングを返す。
 * まず事前計算スナップショット("global_gap")を読み、無ければ LIVE 計算へフォールバック。
 * いかなる失敗でも空配列（防御的）。
 */
export async function getGlobalGap(limit = 30): Promise<GlobalGapRow[]> {
  try {
    const rows = await fromSnapshotOrLive("global_gap", getGlobalGapLive);
    // スナップショットは limit=30 で保存されているため、ここで limit を適用する
    return (rows ?? []).slice(0, limit);
  } catch {
    return [];
  }
}
