/**
 * 総合ランキング（今期クール）。
 *
 * 今期の非 movie 作品について、以下のシグナルをコホート内パーセンタイル(0〜100)に
 * 正規化して加重平均した総合スコア(0〜100)でランキングする。
 *
 * シグナルと重み:
 *   - 認知 (popularity = Annict watchers)              重み 0.25
 *   - 批評 (anilist_score、無ければ mal_score×10)       重み 0.20
 *   - 実況エンゲージ (ニコニコ実況コメント総数)             重み 0.20
 *   - X バズ (最新 volume_score, episode_id is null)    重み 0.20
 *   - 継続/満足 (Annict 満足度 or analytics_work_stats)  重み 0.15
 *
 * 欠測シグナルは「その作品でそのシグナルを除外し、残り重みで再正規化」する（防御的）。
 * 各作品に総合スコア＋シグナル別パーセンタイルの内訳を持たせる。
 */
import { getAdminClient } from "../supabase/admin.ts";
import { seasonOf } from "../season.ts";
import { memoizeTTL } from "../cache.ts";
import { fromSnapshotOrLive } from "./snapshots.ts";
import { getCollectedLogs } from "./collectedLogs.ts";

const chunk = <T,>(arr: T[], size: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
};

export interface OverallRankingSignals {
  /** 認知パーセンタイル (0-100, high=good). null = 欠測 */
  awareness: number | null;
  /** 批評パーセンタイル */
  review: number | null;
  /** 実況エンゲージパーセンタイル */
  jikkyo: number | null;
  /** X バズパーセンタイル */
  xbuzz: number | null;
  /** 継続/満足パーセンタイル */
  retention: number | null;
}

export interface OverallRankingRow {
  workId: string;
  title: string;
  posterUrl: string | null;
  /** 総合スコア 0-100（高いほど良い） */
  score: number;
  /** シグナル別パーセンタイル内訳 */
  signals: OverallRankingSignals;
  /** 生値（参考） */
  raw: {
    popularity: number | null;
    reviewScore: number | null;
    jikkyoComments: number | null;
    xVolume: number | null;
    satisfactionRate: number | null;
  };
}

export type OverallRanking = OverallRankingRow[];

/* ------------------------------------------------------------------ 純関数 */

/**
 * 値の配列からパーセンタイル関数を返す（0〜100、高いほど良い）。
 * 値が大きいほどパーセンタイルが高い（ascending = best）。
 * 空なら常に null を返す。
 */
function percentileFn(values: number[]): (v: number) => number {
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  if (n === 0) return () => 0;
  return (v: number): number => {
    // 自身以下の要素数 / (n-1) * 100
    let lo = 0;
    let hi = n - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (sorted[mid] <= v) lo = mid;
      else hi = mid - 1;
    }
    // countLessOrEqual / (n-1) * 100 → 0〜100
    const countBelow = sorted.filter((x) => x < v).length;
    const countEqual = sorted.filter((x) => x === v).length;
    // 同率の場合は中間点を使う（midpoint法）
    const pct = n <= 1 ? 100 : ((countBelow + countEqual / 2) / (n - 1)) * 100;
    return Math.max(0, Math.min(100, Math.round(pct * 10) / 10));
  };
}

/**
 * 欠測を含むシグナルを重み付き平均してスコア(0〜100)に変換する。
 * 欠測シグナルは重み再正規化して除外。
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

/* ------------------------------------------------------------------ データ取得 */

/**
 * 今期作品の総合ランキングを計算する（スナップショット/メモ化を経由しない LIVE 計算）。
 * compute-snapshots から呼ぶ。
 */
export async function getOverallRankingUncached(): Promise<OverallRanking> {
  try {
    const db = getAdminClient();
    const { year, season } = seasonOf(new Date());

    // 1) 今期の非 movie 作品一覧
    const { data: works, error: worksErr } = await db
      .from("works")
      .select("id, title, poster_url, key_visual_url, popularity, anilist_score, mal_score")
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
    };
    const workList = works as WorkRow[];
    const workIds = workList.map((w) => w.id);

    // 2) 実況コメント総数 per work（getCollectedLogs + programs の work_id 紐付け）
    const jikkyoByWork = new Map<string, number>();
    try {
      const allLogs = await getCollectedLogs();
      const countByProgram = new Map(allLogs.map((l) => [l.program_id, l.comment_count]));
      const programIds = [...countByProgram.keys()];
      for (const ids of chunk(programIds, 150)) {
        const { data, error } = await db
          .from("programs")
          .select("id, work_id")
          .in("id", ids)
          .in("work_id", workIds);
        if (error) continue;
        for (const p of data ?? []) {
          const wid = p.work_id as string;
          const c = countByProgram.get(p.id as string) ?? 0;
          jikkyoByWork.set(wid, (jikkyoByWork.get(wid) ?? 0) + c);
        }
      }
    } catch {
      // 実況データなしで続行
    }

    // 3) X バズ per work（episode_id is null の最新 volume_score）
    const xVolumeByWork = new Map<string, number>();
    try {
      type BuzzRow = { work_id: string; volume_score: number; captured_at: string };
      for (const ids of chunk(workIds, 100)) {
        let rows: BuzzRow[] = [];

        const res = await db
          .from("analytics_x_buzz")
          .select("work_id, volume_score, captured_at")
          .in("work_id", ids)
          .is("episode_id", null)
          .order("captured_at", { ascending: false })
          .limit(2000);
        if (res.error) {
          // episode_id カラム未作成のフォールバック
          const basic = await db
            .from("analytics_x_buzz")
            .select("work_id, volume_score, captured_at")
            .in("work_id", ids)
            .order("captured_at", { ascending: false })
            .limit(2000);
          if (!basic.error) {
            rows = (basic.data ?? []) as BuzzRow[];
          }
        } else {
          rows = (res.data ?? []) as BuzzRow[];
        }
        for (const r of rows) {
          const wid = r.work_id as string;
          if (!xVolumeByWork.has(wid)) {
            xVolumeByWork.set(wid, Number(r.volume_score) || 0);
          }
        }
      }
    } catch {
      // X バズなしで続行
    }

    // 4) 継続/満足（analytics_work_stats の最新 satisfaction_rate）
    const satisfactionByWork = new Map<string, number>();
    try {
      for (const ids of chunk(workIds, 100)) {
        const { data } = await db
          .from("analytics_work_stats")
          .select("work_id, satisfaction_rate, snapshot_date")
          .in("work_id", ids)
          .order("snapshot_date", { ascending: false });
        for (const r of data ?? []) {
          const o = r as Record<string, unknown>;
          if (o.satisfaction_rate == null) continue;
          const wid = o.work_id as string;
          if (!satisfactionByWork.has(wid)) {
            satisfactionByWork.set(wid, Number(o.satisfaction_rate));
          }
        }
      }
    } catch {
      // 満足度なしで続行
    }

    // 5) 各作品の生値を組み立て
    interface RawSignals {
      workId: string;
      title: string;
      posterUrl: string | null;
      popularity: number | null;
      reviewScore: number | null;
      jikkyoComments: number | null;
      xVolume: number | null;
      satisfactionRate: number | null;
    }

    const raws: RawSignals[] = workList.map((w) => {
      const popularity = (w.popularity ?? 0) > 0 ? w.popularity : null;
      const reviewScore =
        w.anilist_score != null
          ? w.anilist_score
          : w.mal_score != null
            ? Math.round(Number(w.mal_score) * 10)
            : null;
      const jikkyoComments = jikkyoByWork.get(w.id) ?? null;
      const xVolume = xVolumeByWork.has(w.id) ? (xVolumeByWork.get(w.id) ?? null) : null;
      const satisfactionRate = satisfactionByWork.get(w.id) ?? null;

      return {
        workId: w.id,
        title: w.title,
        posterUrl: w.poster_url ?? w.key_visual_url ?? null,
        popularity: popularity ?? null,
        reviewScore,
        jikkyoComments: jikkyoComments != null && jikkyoComments > 0 ? jikkyoComments : null,
        xVolume,
        satisfactionRate,
      };
    });

    // 6) コホート内パーセンタイル関数を生成（シグナルごと）
    const popularityVals = raws.map((r) => r.popularity).filter((v): v is number => v != null);
    const reviewVals = raws.map((r) => r.reviewScore).filter((v): v is number => v != null);
    const jikkyoVals = raws.map((r) => r.jikkyoComments).filter((v): v is number => v != null);
    const xVolumeVals = raws.map((r) => r.xVolume).filter((v): v is number => v != null);
    const satVals = raws.map((r) => r.satisfactionRate).filter((v): v is number => v != null);

    const popPct = percentileFn(popularityVals);
    const reviewPct = percentileFn(reviewVals);
    const jikkyoPct = percentileFn(jikkyoVals);
    const xPct = percentileFn(xVolumeVals);
    const satPct = percentileFn(satVals);

    // 7) スコア計算
    const rows: OverallRankingRow[] = raws.map((r) => {
      const awarenessP = r.popularity != null && popularityVals.length > 0 ? popPct(r.popularity) : null;
      const reviewP = r.reviewScore != null && reviewVals.length > 0 ? reviewPct(r.reviewScore) : null;
      const jikkyoP = r.jikkyoComments != null && jikkyoVals.length > 0 ? jikkyoPct(r.jikkyoComments) : null;
      const xP = r.xVolume != null && xVolumeVals.length > 0 ? xPct(r.xVolume) : null;
      const satP = r.satisfactionRate != null && satVals.length > 0 ? satPct(r.satisfactionRate) : null;

      const score = computeWeightedScore([
        { value: awarenessP, weight: 0.25 },
        { value: reviewP, weight: 0.20 },
        { value: jikkyoP, weight: 0.20 },
        { value: xP, weight: 0.20 },
        { value: satP, weight: 0.15 },
      ]);

      return {
        workId: r.workId,
        title: r.title,
        posterUrl: r.posterUrl,
        score,
        signals: {
          awareness: awarenessP,
          review: reviewP,
          jikkyo: jikkyoP,
          xbuzz: xP,
          retention: satP,
        },
        raw: {
          popularity: r.popularity,
          reviewScore: r.reviewScore,
          jikkyoComments: r.jikkyoComments,
          xVolume: r.xVolume,
          satisfactionRate: r.satisfactionRate,
        },
      };
    });

    // 総合スコア降順にソート
    rows.sort((a, b) => b.score - a.score);
    return rows;
  } catch {
    return [];
  }
}

/** 総合ランキングの LIVE 計算（30分メモ化）。スナップショット欠如時のフォールバック。 */
const getOverallRankingLive = memoizeTTL(
  getOverallRankingUncached,
  () => "overall_ranking",
  30 * 60 * 1000,
);

/**
 * 今期作品の総合ランキング。
 * まず事前計算スナップショット("overall_ranking")を読み、無ければ LIVE 計算へフォールバック。
 */
export function getOverallRanking(): Promise<OverallRanking> {
  return fromSnapshotOrLive("overall_ranking", getOverallRankingLive);
}
