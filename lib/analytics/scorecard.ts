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
import { seasonOf, SEASON_LABELS } from "../season.ts";
import type { Season } from "../types.ts";
import { memoizeTTL } from "../cache.ts";

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
  scoreDev: number | null; // 評価スコアの偏差値（score欠損時はnull）
  overall: number; // 総合偏差値
  darkhorse: number; // ダークホース指数 = 認知順位 - 熱量順位（+ほど語られている）
  quadrant: Quadrant;
  // バズ vs 評価ギャップ = 認知偏差値 - 評価偏差値（+話題先行/-評価先行）。score欠損時はnull
  buzzRatingGap: number | null;
  // フラグ
  sleeper: boolean; // 高評価だが認知が低い＝過小評価/発掘候補
  overhyped: boolean; // 認知は高いが評価が伴わない＝話題先行
  // パーセンタイル（上位X%。値が無い指標はnull）
  overallPercentile: number; // 総合の上位X%
  percentiles: {
    awareness: number | null;
    passion: number | null;
    satisfaction: number | null;
    score: number | null;
  };
}

export interface CoolScorecard {
  year: number;
  season: "winter" | "spring" | "summer" | "autumn";
  works: ScorecardWork[]; // 総合偏差値の降順
  totalAiring: number; // 今期の対象作品総数
  withData: number; // うち分析できた作品数
}

export interface WorkCohortPosition {
  seasonLabel: string; // 例: "2026年 春"
  cohortSize: number; // クール内で分析できた作品数
  work: ScorecardWork; // この作品のスコアカード
  commentary: string; // 意思決定向けの一言（日本語）
}

/* ----------------------------------------------------------------- 純関数（DB不要・単体テスト可能） */

/**
 * 順位(1=最上位)とクール内作品数 N から「上位X%」を返す。rank/Nが不正ならnull。
 * 最上位(rank=1)ほど小さい値になる（例: 10件中1位 → 上位10%、最下位 → 上位100%）。
 * 0%表示を避けるため下限は1%。
 */
export function pctRankFromRank(rank: number | null | undefined, n: number): number | null {
  if (rank == null || rank < 1 || n < 1) return null;
  return Math.max(1, Math.round((rank / n) * 100));
}

/** バズ vs 評価ギャップ（認知偏差値 - 評価偏差値）。+ほど話題先行、-ほど評価先行。 */
export function buzzRatingGapOf(awarenessDev: number, scoreDev: number | null): number | null {
  if (scoreDev == null) return null;
  return Math.round((awarenessDev - scoreDev) * 10) / 10;
}

/** 高評価だが認知が低い＝過小評価（スリーパー）。 */
export function isSleeper(awarenessDev: number, scoreDev: number | null): boolean {
  return scoreDev != null && scoreDev >= 57 && awarenessDev <= 45;
}

/** 認知は高いが評価が伴わない＝話題先行。 */
export function isOverhyped(awarenessDev: number, scoreDev: number | null): boolean {
  return scoreDev != null && awarenessDev >= 57 && scoreDev <= 45;
}

/** フラグ・象限・ギャップから意思決定向けの一言を生成する。 */
export function cohortCommentary(w: {
  awarenessPct: number | null;
  passionPct: number | null;
  scorePct: number | null;
  sleeper: boolean;
  overhyped: boolean;
  quadrant: Quadrant;
  darkhorse: number;
}): string {
  const aw = w.awarenessPct;
  const sc = w.scorePct;
  const pa = w.passionPct;
  if (w.sleeper && aw != null && sc != null) {
    return `評価は上位${sc}%だが認知は上位${aw}%にとどまる。"過小評価（スリーパー）"の可能性。発掘・先行投資の候補。`;
  }
  if (w.overhyped && aw != null && sc != null) {
    return `認知は上位${aw}%だが評価は上位${sc}%。"話題先行"型で、初速以降の伸びは慎重に見る。`;
  }
  if (w.quadrant === "royal" && aw != null && pa != null) {
    return `認知・熱量ともに上位${Math.min(aw, pa)}%圏内の"王道ヒット型"。マス施策・大量展開が効く。`;
  }
  if (w.quadrant === "wordofmouth" && pa != null) {
    return `熱量は上位${pa}%と高いが認知はこれから。"口コミ型・ダークホース候補"。早期に張ると先行者利益。`;
  }
  if (w.quadrant === "fastburn" && aw != null) {
    return `認知は上位${aw}%だが熱量・定着が弱い"初速一発型"。話題は最初だけになりやすく短期施策向き。`;
  }
  // niche
  if (pa != null) {
    return `認知・熱量とも控えめだがコアは濃い"ニッチ深掘り型"。コア層向けの有料施策が向く。`;
  }
  return `クール内ポジションを相対評価。各指標は偏差値（平均50）。`;
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

// works から偏差値カルテに必要な列だけを抜いた行
interface ScorecardWorkRow {
  id: string;
  title: string;
  poster_url: string | null;
  key_visual_url: string | null;
  popularity: number | null;
  anilist_score: number | null;
  anilist_popularity: number | null;
  mal_score: number | null;
  mal_members: number | null;
}

const WORK_COLUMNS =
  "id, title, poster_url, key_visual_url, popularity, anilist_score, anilist_popularity, mal_score, mal_members";

/** 今期作品のクール診断（偏差値カルテ＋4象限）。挙動は従来どおり。 */
async function getCoolScorecardUncached(): Promise<CoolScorecard> {
  const db = getAdminClient();
  const { year, season } = seasonOf(new Date());

  // 今期の放送中TV作品（従来の選定基準を維持）
  const { data: works } = await db
    .from("works")
    .select(WORK_COLUMNS)
    .eq("status", "airing")
    .or("media.neq.movie,media.is.null");

  return buildScorecard(year, season, (works ?? []) as ScorecardWorkRow[]);
}

/**
 * 今期作品のクール診断（30分メモ化）。エクスポート名・挙動は従来どおり。
 * force-dynamic ページの各レンダリングでの重い集計を抑える。
 */
export const getCoolScorecard = memoizeTTL(getCoolScorecardUncached, () => "cool", 1800000);

/**
 * 任意のクール（year/season）でクール診断を計算する。
 * 過去クールも含め season_year/season_name でTV作品を抽出して相対化する。
 */
export async function computeSeasonScorecard(year: number, season: Season): Promise<CoolScorecard> {
  const db = getAdminClient();
  const { year: curYear, season: curSeason } = seasonOf(new Date());

  // 現行クールは getCoolScorecard と同じ選定（放送中）に委譲して挙動を完全一致させる
  if (year === curYear && season === curSeason) {
    return getCoolScorecard();
  }

  const { data: works } = await db
    .from("works")
    .select(WORK_COLUMNS)
    .eq("season_year", year)
    .eq("season_name", season)
    .or("media.neq.movie,media.is.null");

  return buildScorecard(year, season, (works ?? []) as ScorecardWorkRow[]);
}

/** 与えられたクール作品集合から偏差値カルテを構築する（DBアクセスを伴う共通コア）。 */
async function buildScorecard(
  year: number,
  season: Season,
  workList: ScorecardWorkRow[],
): Promise<CoolScorecard> {
  const db = getAdminClient();
  if (workList.length === 0) return { year, season, works: [], totalAiring: 0, withData: 0 };

  const workIds = workList.map((w) => w.id);

  // 2) 実況コメント（collected log）→ 番組→作品・話数へ
  // ページネーションで全件取得（limit 打ち切りによるサイレント欠損を防ぐ）
  const allLogs: { program_id: string; comment_count: number }[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db
      .from("analytics_collection_log")
      .select("program_id, comment_count")
      .eq("status", "collected")
      .gt("comment_count", 0)
      .range(from, from + 999);
    if (error) break; // エラー時は取得済み分で続行
    allLogs.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  const countByProgram = new Map(allLogs.map((l) => [l.program_id, l.comment_count]));

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
  const scoreVals = raws.filter((r) => r.score != null).map((r) => r.score!);
  const scoreDevFn = deviationFn(scoreVals);

  const n = raws.length;
  const awRank = rankMap(raws.map((r) => ({ id: r.workId, value: r.awareness })));
  const paRank = rankMap(raws.map((r) => ({ id: r.workId, value: r.passion })));
  // 満足度・評価は欠損があるため、値を持つ作品のみで順位付け（パーセンタイル用）
  const satRank = rankMap(
    raws.filter((r) => r.satisfaction != null).map((r) => ({ id: r.workId, value: r.satisfaction! })),
  );
  const satN = satRank.size;
  const scRank = rankMap(
    raws.filter((r) => r.score != null).map((r) => ({ id: r.workId, value: r.score! })),
  );
  const scN = scRank.size;

  const scored: ScorecardWork[] = raws.map((r) => {
    const aDev = awarenessDev(log(r.awareness));
    const pDev = passionDev(log(r.passion));
    const dDev = densityDev(log(r.density));
    const rDev = r.retention != null ? retentionDev(r.retention) : null;
    const sDev = r.satisfaction != null ? satDev(r.satisfaction) : null;
    const scDev = r.score != null ? scoreDevFn(r.score) : null;

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
      scoreDev: scDev,
      overall,
      darkhorse: (awRank.get(r.workId) ?? 0) - (paRank.get(r.workId) ?? 0),
      quadrant,
      buzzRatingGap: buzzRatingGapOf(aDev, scDev),
      sleeper: isSleeper(aDev, scDev),
      overhyped: isOverhyped(aDev, scDev),
      overallPercentile: 0, // 総合順位確定後に下で設定
      percentiles: {
        awareness: pctRankFromRank(awRank.get(r.workId), n),
        passion: pctRankFromRank(paRank.get(r.workId), n),
        satisfaction: pctRankFromRank(satRank.get(r.workId), satN),
        score: pctRankFromRank(scRank.get(r.workId), scN),
      },
    };
  });

  scored.sort((a, b) => b.overall - a.overall);
  // 総合順（降順）が確定したので総合パーセンタイルを設定
  scored.forEach((w, i) => {
    w.overallPercentile = pctRankFromRank(i + 1, scored.length) ?? 0;
  });
  return { year, season, works: scored, totalAiring: workList.length, withData: scored.length };
}

/**
 * 単一作品のクール内ポジションを返す。
 * 作品の season_year/season_name のクールが算出可能で、その作品が母数に入っていれば返す。
 * 実況データ不足等で算出できない場合は null。
 */
async function getWorkCohortPositionUncached(workId: string): Promise<WorkCohortPosition | null> {
  const db = getAdminClient();
  const { data: work } = await db
    .from("works")
    .select("season_year, season_name")
    .eq("id", workId)
    .maybeSingle();
  if (!work || work.season_year == null || work.season_name == null) return null;

  const card = await computeSeasonScorecard(
    work.season_year as number,
    work.season_name as Season,
  );
  const me = card.works.find((w) => w.workId === workId);
  if (!me) return null;

  const commentary = cohortCommentary({
    awarenessPct: me.percentiles.awareness,
    passionPct: me.percentiles.passion,
    scorePct: me.percentiles.score,
    sleeper: me.sleeper,
    overhyped: me.overhyped,
    quadrant: me.quadrant,
    darkhorse: me.darkhorse,
  });

  return {
    seasonLabel: `${card.year}年 ${SEASON_LABELS[card.season]}`,
    cohortSize: card.withData,
    work: me,
    commentary,
  };
}

/**
 * 単一作品のクール内ポジション（workId 単位で30分メモ化）。
 * エクスポート名・挙動は従来どおり。
 */
export const getWorkCohortPosition = memoizeTTL(
  getWorkCohortPositionUncached,
  (workId) => workId,
  1800000,
);
