/**
 * 続編可能性スコア（信号機）— 製作委員会・出版社向け参考指標。
 *
 * 今期（seasonOf）の非 movie 作品について、入手可能な公開データから
 * ヒューリスティックに "続編の機運" を 0〜100 のスコアで評価し、
 * 信号機（green / yellow / red）で示す。
 *
 * **あくまで参考値**: BD/配信売上・グッズ売上・製作委員会の内部事情・
 * 原作者の意向などは一切含まない。公開データのみによる推定。
 *
 * シグナルと重み:
 *   - 継続力（実況残留率）: getJikkyoRetentionSeries(100) の各作品の
 *     「最新話 records ÷ 第1話 records」をコホート内パーセンタイルに。重み 0.30
 *   - 質の代理（AniList/MALスコア）: works.anilist_score / mal_score の
 *     コホート内パーセンタイル。重み 0.20
 *   - 人気規模（Annictウォッチャー）: works.popularity のパーセンタイル。重み 0.25
 *   - 社会的熱量（Xバズ）: getCohortXBuzz(100) の最新 volume(0〜5) の
 *     コホート内パーセンタイル。重み 0.15
 *   - 海外需要（AniList popularity）: works.anilist_popularity のパーセンタイル。重み 0.10
 *
 * 欠測シグナルは重み再正規化（overallRanking.ts と同方式）。
 *
 * 信号機しきい値:
 *   score >= 66 → green（続編期待大）
 *   score 40〜65 → yellow（条件次第）
 *   score < 40  → red（現状は厳しい）
 */

import { getAdminClient } from "../supabase/admin.ts";
import { seasonOf } from "../season.ts";
import { memoizeTTL } from "../cache.ts";
import { fromSnapshotOrLive } from "./snapshots.ts";
import { getJikkyoRetentionSeries } from "./viewing.ts";
import { getCohortXBuzz } from "./xbuzz.ts";

/* ----------------------------------------------------------------- 型 */

export type SequelSignal = "green" | "yellow" | "red";

export interface SequelProspectRow {
  workId: string;
  title: string;
  posterUrl: string | null;
  /** 総合スコア 0〜100 */
  score: number;
  /** 信号機: green=続編期待大 / yellow=条件次第 / red=現状は厳しい */
  signal: SequelSignal;
  /** 実況残留率（最新話 / 第1話 の比率, 0〜100）。欠測なら null */
  retentionPct: number | null;
  /** 人気パーセンタイル (0〜100) */
  popularityPctl: number | null;
  /** 最新 Xバズ volume (0〜5)。欠測なら null */
  xVolume: number | null;
}

export type SequelProspect = SequelProspectRow[];

/* ----------------------------------------------------------------- 純関数 */

/**
 * 値の配列からパーセンタイル関数を返す（0〜100、高いほど高パーセンタイル）。
 * overallRanking.ts と同実装（midpoint 法）。
 */
function percentileFn(values: number[]): (v: number) => number {
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  if (n === 0) return () => 0;
  return (v: number): number => {
    const countBelow = sorted.filter((x) => x < v).length;
    const countEqual = sorted.filter((x) => x === v).length;
    const pct = n <= 1 ? 100 : ((countBelow + countEqual / 2) / (n - 1)) * 100;
    return Math.max(0, Math.min(100, Math.round(pct * 10) / 10));
  };
}

/**
 * 欠測を含むシグナルを重み付き平均してスコア(0〜100)に変換。
 * 欠測シグナルは重み再正規化して除外。overallRanking.ts と同方式。
 */
function computeWeightedScore(
  signals: { value: number | null; weight: number }[],
): number {
  const present = signals.filter((s) => s.value != null);
  if (present.length === 0) return 0;
  const wsum = present.reduce((a, s) => a + s.weight, 0);
  if (wsum === 0) return 0;
  const raw = present.reduce((a, s) => a + (s.value ?? 0) * (s.weight / wsum), 0);
  return Math.round(raw * 10) / 10;
}

/** スコアから信号機を決定する。 */
function toSignal(score: number): SequelSignal {
  if (score >= 66) return "green";
  if (score >= 40) return "yellow";
  return "red";
}

/* ----------------------------------------------------------------- データ取得 */

/**
 * 今期作品の続編可能性スコアを計算する（スナップショット/メモ化を経由しない LIVE 計算）。
 * compute-snapshots から呼ぶ。
 */
export async function getSequelProspectUncached(limit = 30): Promise<SequelProspect> {
  try {
    const db = getAdminClient();
    const { year, season } = seasonOf(new Date());

    // 1) 今期の非 movie 作品一覧（popularity / anilist_score / mal_score / anilist_popularity）
    const { data: works, error: worksErr } = await db
      .from("works")
      .select("id, title, poster_url, key_visual_url, popularity, anilist_score, mal_score, anilist_popularity")
      .eq("season_year", year)
      .eq("season_name", season)
      .or("media.neq.movie,media.is.null");
    if (worksErr || !works || works.length === 0) return [];

    type WorkRow = {
      id: string;
      title: string;
      poster_url: string | null;
      key_visual_url: string | null;
      popularity: number | null;
      anilist_score: number | null;
      mal_score: number | null;
      anilist_popularity: number | null;
    };
    const workList = works as WorkRow[];
    const workIdSet = new Set(workList.map((w) => w.id));

    // 2) 実況残留率: getJikkyoRetentionSeries の結果から最新話残留率を抽出
    const retentionByWork = new Map<string, number>();
    try {
      const retResult = await getJikkyoRetentionSeries(100);
      for (const s of retResult.series) {
        if (!workIdSet.has(s.workId)) continue;
        if (s.points.length < 2) continue;
        const base = s.points[0].records;
        const last = s.points[s.points.length - 1].records;
        if (base > 0 && last > 0) {
          const pct = Math.round((last / base) * 1000) / 10; // 0〜100(+)
          retentionByWork.set(s.workId, pct);
        }
      }
    } catch {
      // 残留率なしで続行
    }

    // 3) Xバズ: getCohortXBuzz から最新 volume を取得
    const xVolumeByWork = new Map<string, number>();
    try {
      const buzzRows = await getCohortXBuzz(100);
      for (const b of buzzRows) {
        if (workIdSet.has(b.workId)) {
          xVolumeByWork.set(b.workId, b.volume);
        }
      }
    } catch {
      // Xバズなしで続行
    }

    // 4) 各作品の生値を組み立て
    interface RawRow {
      workId: string;
      title: string;
      posterUrl: string | null;
      popularity: number | null;
      reviewScore: number | null;
      retentionPct: number | null;
      xVolume: number | null;
      anilistPopularity: number | null;
    }

    const raws: RawRow[] = workList.map((w) => {
      const popularity = (w.popularity ?? 0) > 0 ? w.popularity : null;
      // AniList スコア優先、なければ MAL×10
      const reviewScore =
        w.anilist_score != null
          ? w.anilist_score
          : w.mal_score != null
            ? Math.round(Number(w.mal_score) * 10)
            : null;
      const retentionPct = retentionByWork.get(w.id) ?? null;
      const xVolume = xVolumeByWork.has(w.id) ? (xVolumeByWork.get(w.id) ?? null) : null;
      const anilistPopularity = (w.anilist_popularity ?? 0) > 0 ? w.anilist_popularity : null;

      return {
        workId: w.id,
        title: w.title,
        posterUrl: w.poster_url ?? w.key_visual_url ?? null,
        popularity,
        reviewScore,
        retentionPct,
        xVolume,
        anilistPopularity,
      };
    });

    // 5) コホート内パーセンタイル関数を生成（シグナルごと）
    const retentionVals = raws.map((r) => r.retentionPct).filter((v): v is number => v != null);
    const reviewVals = raws.map((r) => r.reviewScore).filter((v): v is number => v != null);
    const popularityVals = raws.map((r) => r.popularity).filter((v): v is number => v != null);
    const xVolumeVals = raws.map((r) => r.xVolume).filter((v): v is number => v != null);
    const anilistPopVals = raws.map((r) => r.anilistPopularity).filter((v): v is number => v != null);

    const retPct = percentileFn(retentionVals);
    const reviewPct = percentileFn(reviewVals);
    const popPct = percentileFn(popularityVals);
    const xPct = percentileFn(xVolumeVals);
    const anilistPopPct = percentileFn(anilistPopVals);

    // 6) スコア計算 → 信号機 → 行組み立て
    const rows: SequelProspectRow[] = raws.map((r) => {
      const retP = r.retentionPct != null && retentionVals.length > 0 ? retPct(r.retentionPct) : null;
      const reviewP = r.reviewScore != null && reviewVals.length > 0 ? reviewPct(r.reviewScore) : null;
      const popP = r.popularity != null && popularityVals.length > 0 ? popPct(r.popularity) : null;
      const xP = r.xVolume != null && xVolumeVals.length > 0 ? xPct(r.xVolume) : null;
      const anilistPopP = r.anilistPopularity != null && anilistPopVals.length > 0 ? anilistPopPct(r.anilistPopularity) : null;

      const score = computeWeightedScore([
        { value: retP,        weight: 0.30 }, // 継続力
        { value: reviewP,     weight: 0.20 }, // 質の代理
        { value: popP,        weight: 0.25 }, // 人気規模
        { value: xP,          weight: 0.15 }, // 社会的熱量
        { value: anilistPopP, weight: 0.10 }, // 海外需要
      ]);

      return {
        workId: r.workId,
        title: r.title,
        posterUrl: r.posterUrl,
        score,
        signal: toSignal(score),
        retentionPct: r.retentionPct,
        popularityPctl: popP,
        xVolume: r.xVolume,
      };
    });

    // score 降順にソート
    rows.sort((a, b) => b.score - a.score);
    return rows.slice(0, limit);
  } catch {
    return [];
  }
}

/** 続編可能性スコアの LIVE 計算（30分メモ化）。スナップショット欠如時のフォールバック。 */
const getSequelProspectLive = memoizeTTL(
  getSequelProspectUncached,
  (limit = 30) => `sequel_prospect:${limit}`,
  30 * 60 * 1000,
);

/**
 * 今期作品の続編可能性スコア。
 * まず事前計算スナップショット("sequel_prospect")を読み、無ければ LIVE 計算へフォールバック。
 */
export function getSequelProspect(limit = 30): Promise<SequelProspect> {
  return fromSnapshotOrLive("sequel_prospect", () => getSequelProspectLive(limit));
}
