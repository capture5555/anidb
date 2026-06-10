/**
 * クール診断（偏差値カルテ）のデータ層。
 *
 * 「アニメ作品分析AI」フレームワークを、手元の実データだけで実装する。
 * - 認知規模  = Annictウォッチャー数（無ければAniList利用者数）… 検索量の代替（正直に明記）
 * - 熱量      = ニコニコ実況のコメント総数 … SNS投稿量の代替
 * - 熱量密度  = 熱量 ÷ 認知規模（規模が小さくても濃く語られているか）
 * - 定着力    = 維持率（直近話の実況コメント ÷ 初回話）
 * - 満足度    = Annictの「良い」評価率（analytics_work_stats.satisfaction_rate）
 * - 総合偏差値 = 上記の偏差値を重み付け合算（クール内で相対化）
 *
 * 取得できない指標（検索量・SNS・タイムシフト比率）は算出せず、UI側で「データなし」と明記する。
 * すべて各サービス利用者を母数とした参考値であり、テレビ視聴率ではない。
 */
import { getAdminClient } from "../supabase/admin.ts";
import { seasonOf } from "../season.ts";

const chunk = <T,>(arr: T[], size: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
};

export type Quadrant = "royal" | "wordofmouth" | "fastburn" | "niche";

export const QUADRANT_LABELS: Record<Quadrant, string> = {
  royal: "王道ヒット",
  wordofmouth: "口コミ型・ダークホース候補",
  fastburn: "初速一発型",
  niche: "ニッチ深掘り型",
};

export const QUADRANT_NOTES: Record<Quadrant, string> = {
  royal: "認知も熱量も高い。マス向けタイアップ・大量展開が効く。",
  wordofmouth: "熱量は高いが認知はこれから。早期に張ると先行者利益。配信レコメンド・継続施策。",
  fastburn: "認知は高いが熱量・定着が弱い。話題は最初だけ。短期施策に限定。",
  niche: "認知も熱量も控えめだがコアが濃い。コア層向けグッズ・有料施策。",
};

export interface ScorecardWork {
  workId: string;
  title: string;
  posterUrl: string | null;
  // 生値
  awareness: number; // 認知規模（人）
  passion: number; // 熱量（実況コメント総数）
  density: number; // 熱量密度（コメント/人）
  retention: number | null; // 定着力（維持率, 直近÷初回。1.0=横ばい）
  satisfaction: number | null; // 満足度%
  score: number | null; // 評価スコア（AniList 0-100 を優先, 無ければMALを100換算）
  episodesCovered: number; // 実況データのある話数
  // 偏差値（クール内・mean50/sd10）
  awarenessDev: number;
  passionDev: number;
  densityDev: number;
  retentionDev: number | null;
  satisfactionDev: number | null;
  overall: number; // 総合偏差値
  darkhorse: number; // ダークホース指数 = 認知順位 - 熱量順位（+ほど語られている）
  quadrant: Quadrant;
}

export interface CoolScorecard {
  year: number;
  season: "winter" | "spring" | "summer" | "autumn";
  works: ScorecardWork[]; // 総合偏差値の降順
  totalAiring: number; // 今期の対象作品総数
  withData: number; // うち分析できた作品数
}

/** 配列を偏差値（mean50/sd10）に変換するクロージャを返す */
function deviationFn(values: number[]): (v: number) => number {
  const n = values.length;
  if (n === 0) return () => 50;
  const mean = values.reduce((a, b) => a + b, 0) / n;
  const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / n;
  const sd = Math.sqrt(variance);
  if (sd === 0) return () => 50;
  return (v: number) => Math.round((50 + (10 * (v - mean)) / sd) * 10) / 10;
}

/** 順位（1=最大）。同値は同順位ではなく安定ソート順。 */
function rankMap(items: { id: string; value: number }[]): Map<string, number> {
  const sorted = [...items].sort((a, b) => b.value - a.value);
  const m = new Map<string, number>();
  sorted.forEach((it, i) => m.set(it.id, i + 1));
  return m;
}

const MIN_PASSION = 300; // この未満の実況コメントしか無い作品は対象外（ノイズ）

/** 今期作品のクール診断（偏差値カルテ＋4象限）。 */
export async function getCoolScorecard(): Promise<CoolScorecard> {
  const db = getAdminClient();
  const { year, season } = seasonOf(new Date());

  // 1) 今期の放送中TV作品
  const { data: works } = await db
    .from("works")
    .select(
      "id, title, poster_url, key_visual_url, popularity, anilist_score, anilist_popularity, mal_score, mal_members",
    )
    .eq("status", "airing")
    .or("media.neq.movie,media.is.null");
  const workList = works ?? [];
  if (workList.length === 0) return { year, season, works: [], totalAiring: 0, withData: 0 };

  const workIds = workList.map((w) => w.id);
  const workMeta = new Map(workList.map((w) => [w.id, w]));

  // 2) 実況コメント（collected log）→ 番組→作品・話数へ
  const { data: logs } = await db
    .from("analytics_collection_log")
    .select("program_id, comment_count")
    .eq("status", "collected")
    .gt("comment_count", 0)
    .limit(5000);
  const countByProgram = new Map((logs ?? []).map((l) => [l.program_id, l.comment_count]));

  // 対象作品の番組（話数別の代表＝最大コメント数のチャンネル）
  const epByWork = new Map<string, Map<string, { sort: number; count: number }>>();
  for (const ids of chunk(workIds, 100)) {
    const { data } = await db
      .from("programs")
      .select("id, work_id, episode_id, episodes(sort)")
      .in("work_id", ids)
      .eq("is_rebroadcast", false)
      .not("episode_id", "is", null);
    for (const p of data ?? []) {
      const c = countByProgram.get(p.id);
      if (c == null) continue;
      if (!epByWork.has(p.work_id)) epByWork.set(p.work_id, new Map());
      const eps = epByWork.get(p.work_id)!;
      const key = p.episode_id as string;
      const cur = eps.get(key);
      if (!cur || c > cur.count) eps.set(key, { sort: (p as any).episodes?.sort ?? 0, count: c });
    }
  }

  // 3) 満足度（analytics_work_stats の最新スナップショット）
  const satByWork = new Map<string, number>();
  try {
    for (const ids of chunk(workIds, 100)) {
      const { data } = await db
        .from("analytics_work_stats")
        .select("work_id, satisfaction_rate, snapshot_date")
        .in("work_id", ids)
        .order("snapshot_date", { ascending: false });
      for (const r of data ?? []) {
        if (r.satisfaction_rate == null) continue;
        if (!satByWork.has(r.work_id)) satByWork.set(r.work_id, Number(r.satisfaction_rate));
      }
    }
  } catch {
    // テーブル/列が無い環境では満足度なしで続行
  }

  // 4) 作品ごとの生指標を組み立て
  interface Raw {
    workId: string;
    title: string;
    posterUrl: string | null;
    awareness: number;
    passion: number;
    density: number;
    retention: number | null;
    satisfaction: number | null;
    score: number | null;
    episodesCovered: number;
  }
  const raws: Raw[] = [];
  for (const w of workList) {
    const eps = epByWork.get(w.id);
    if (!eps || eps.size === 0) continue;
    const sorted = [...eps.values()].sort((a, b) => a.sort - b.sort);
    const passion = sorted.reduce((a, b) => a + b.count, 0);
    if (passion < MIN_PASSION) continue;

    const awareness = (w.popularity ?? 0) > 0 ? w.popularity : (w.anilist_popularity ?? 0);
    if (!awareness || awareness <= 0) continue;

    const retention =
      sorted.length >= 2 && sorted[0].count > 0
        ? Math.round((sorted[sorted.length - 1].count / sorted[0].count) * 1000) / 1000
        : null;
    const score =
      w.anilist_score != null
        ? w.anilist_score
        : w.mal_score != null
          ? Math.round(Number(w.mal_score) * 10)
          : null;

    raws.push({
      workId: w.id,
      title: w.title,
      posterUrl: w.poster_url ?? w.key_visual_url ?? null,
      awareness,
      passion,
      density: Math.round((passion / awareness) * 1000) / 1000,
      retention,
      satisfaction: satByWork.get(w.id) ?? null,
      score,
      episodesCovered: sorted.length,
    });
  }

  if (raws.length === 0) {
    return { year, season, works: [], totalAiring: workList.length, withData: 0 };
  }

  // 5) クール内で偏差値化（コメント数・認知規模・密度は対数化＝裾が長いため）
  const log = (v: number) => Math.log10(Math.max(1, v));
  const awarenessDev = deviationFn(raws.map((r) => log(r.awareness)));
  const passionDev = deviationFn(raws.map((r) => log(r.passion)));
  const densityDev = deviationFn(raws.map((r) => log(r.density)));
  const retentionVals = raws.filter((r) => r.retention != null).map((r) => r.retention!);
  const retentionDev = deviationFn(retentionVals);
  const satVals = raws.filter((r) => r.satisfaction != null).map((r) => r.satisfaction!);
  const satDev = deviationFn(satVals);

  const awRank = rankMap(raws.map((r) => ({ id: r.workId, value: r.awareness })));
  const paRank = rankMap(raws.map((r) => ({ id: r.workId, value: r.passion })));

  const scored: ScorecardWork[] = raws.map((r) => {
    const aDev = awarenessDev(log(r.awareness));
    const pDev = passionDev(log(r.passion));
    const dDev = densityDev(log(r.density));
    const rDev = r.retention != null ? retentionDev(r.retention) : null;
    const sDev = r.satisfaction != null ? satDev(r.satisfaction) : null;

    // 総合偏差値: 認知0.3 / 熱量0.3 / 定着0.2 / 満足0.2（欠損は重みを再正規化）
    const parts: { v: number; w: number }[] = [
      { v: aDev, w: 0.3 },
      { v: pDev, w: 0.3 },
    ];
    if (rDev != null) parts.push({ v: rDev, w: 0.2 });
    if (sDev != null) parts.push({ v: sDev, w: 0.2 });
    const wsum = parts.reduce((a, b) => a + b.w, 0);
    const overall = Math.round((parts.reduce((a, b) => a + b.v * b.w, 0) / wsum) * 10) / 10;

    const quadrant: Quadrant =
      aDev >= 50 && pDev >= 50
        ? "royal"
        : aDev < 50 && pDev >= 50
          ? "wordofmouth"
          : aDev >= 50 && pDev < 50
            ? "fastburn"
            : "niche";

    return {
      ...r,
      awarenessDev: aDev,
      passionDev: pDev,
      densityDev: dDev,
      retentionDev: rDev,
      satisfactionDev: sDev,
      overall,
      darkhorse: (awRank.get(r.workId) ?? 0) - (paRank.get(r.workId) ?? 0),
      quadrant,
    };
  });

  scored.sort((a, b) => b.overall - a.overall);
  return { year, season, works: scored, totalAiring: workList.length, withData: scored.length };
}
