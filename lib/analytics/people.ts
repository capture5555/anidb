/**
 * 人材スコアカード — 声優・スタッフごとの意思決定グレード指標を算出する。
 *
 * 同定方法は既存のビューと完全に一致させる:
 *   声優  : work_casts.person_name（v_va_ranking と同じ。work_id で重複排除）
 *   スタッフ: work_staff.role を部分一致でロールバケットに振り分け（監督/シリーズ構成/キャラクターデザイン）
 *
 * スコア解決・シーズン中央値・統計ヘルパーは studios.ts と完全に共有する。
 * 新規の算術（percentile）も純関数としてエクスポートし、DBなしで単体テスト可能にする。
 */

import { getAdminClient } from "../supabase/admin.ts";
import {
  median,
  mean,
  coefficientOfVariation,
  consistencyFromCv,
  battingAverage,
} from "./studios.ts";
import { memoizeTTL } from "../cache.ts";

/* ================================================================
   純関数（単体テスト可）
   ================================================================ */

/**
 * パーセンタイル（線形補間）。
 * @param nums サンプル配列
 * @param p    0..100
 * 空配列は NaN。p はクランプされる。
 */
export function percentile(nums: number[], p: number): number {
  if (nums.length === 0) return NaN;
  const sorted = [...nums].sort((a, b) => a - b);
  if (sorted.length === 1) return sorted[0];
  const pc = Math.max(0, Math.min(100, p));
  const rank = (pc / 100) * (sorted.length - 1);
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  if (lo === hi) return sorted[lo];
  const frac = rank - lo;
  return sorted[lo] + (sorted[hi] - sorted[lo]) * frac;
}

/**
 * モメンタム — 直近平均スコア − 通算平均スコア。
 * 直近スコアが2件未満のときは null（プラス＝上昇基調）。
 * @param recent 直近のスコア配列
 * @param career 通算のスコア配列
 */
export function momentumDelta(recent: number[], career: number[]): number | null {
  if (recent.length < 2 || career.length === 0) return null;
  return Math.round((mean(recent) - mean(career)) * 10) / 10;
}

/* ================================================================
   型
   ================================================================ */

export interface VaScorecard {
  name: string;
  appearances: number; // 出演作品数（distinct work）
  leadAppearances: number; // 主演級（sort <= 2）作品数
  leadRatio: number; // lead / appearances（round 2）
  scoredWorks: number;
  avgScore: number; // スコア付き作品の平均
  leadAvgScore: number | null; // 主演かつスコア付き作品の平均（無ければ null）
  battingAverage: number; // 0..1（同クール中央値以上の割合）
  momentum: number | null; // 直近2年 − 通算の平均スコア差
  breakout: boolean; // 直近1年に主演かつ当該クールP90以上の作品があるか
}

export type StaffRoleKey = "director" | "series" | "chardesign";

export interface StaffYearAvg {
  year: number;
  avgScore: number;
}

export interface StaffScorecard {
  name: string;
  works: number; // 当該バケット内の作品数（distinct work）
  scoredWorks: number;
  avgScore: number;
  consistency: number | null; // <2 のとき null
  battingAverage: number; // 0..1
  yearTrend: StaffYearAvg[]; // 直近4年分、昇順
}

/* ================================================================
   DB アクセス層
   ================================================================ */

/** ワーク1行 — 集計に必要な列だけ */
interface WorkRow {
  id: string;
  season_year: number | null;
  season_name: string | null;
  anilist_score: number | null;
  mal_score: number | null; // numeric → number に変換
}

/** work_casts + works の結合行 */
interface CastWorkRow {
  person_name: string;
  work_id: string;
  sort: number | null;
  works: WorkRow;
}

/** work_staff + works の結合行 */
interface StaffWorkRow {
  person_name: string;
  role: string;
  work_id: string;
  works: WorkRow;
}

/** スコア（AniList 優先、なければ MAL*10）を求める。両方なければ null。*/
function resolveScore(w: WorkRow): number | null {
  if (w.anilist_score != null) return w.anilist_score;
  if (w.mal_score != null) return Math.round(Number(w.mal_score) * 10);
  return null;
}

const SELECT_WORK = "id, season_year, season_name, anilist_score, mal_score";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function paginate<T>(build: (from: number) => any): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await build(from).range(from, from + 999);
    if (error) throw error;
    out.push(...((data ?? []) as T[]));
    if (!data || data.length < 1000) break;
  }
  return out;
}

/** season_year+season_name キー */
function seasonKey(w: WorkRow): string | null {
  if (!w.season_year || !w.season_name) return null;
  return `${w.season_year}|${w.season_name}`;
}

/**
 * 全シーズン作品スコアから season キー → { median, p90 } を構築する。
 * @param scoresBySeason season キー → スコア配列
 */
function buildSeasonStats(
  scoresBySeason: Map<string, number[]>,
): Map<string, { median: number; p90: number }> {
  const out = new Map<string, { median: number; p90: number }>();
  for (const [key, scores] of scoresBySeason) {
    out.set(key, { median: median(scores), p90: percentile(scores, 90) });
  }
  return out;
}

/* ================================================================
   声優スコアカード
   ================================================================ */

/**
 * 声優スコアカードを返す。
 * 声優の同定は v_va_ranking と同じ（work_casts.person_name, work_id で重複排除）。
 * 主演級は work_casts.sort <= 2 を近似指標とする。
 *
 * @param opts.minWorks ノイズフロア（スコア付き作品の下限, デフォルト 3）
 * @param opts.limit    上位N件（leadAvgScore 降順, null は最後）。デフォルト 30。
 */
async function getVoiceActorScorecardsUncached(opts?: {
  minWorks?: number;
  limit?: number;
}): Promise<VaScorecard[]> {
  const minWorks = opts?.minWorks ?? 3;
  const limit = opts?.limit ?? 30;
  const curYear = new Date().getFullYear();

  const db = getAdminClient();

  const rows = await paginate<CastWorkRow>((from) =>
    db
      .from("work_casts")
      .select(`person_name, work_id, sort, works!inner(${SELECT_WORK})`)
      .not("person_name", "is", null)
      .neq("person_name", ""),
  );

  /* 1. シーズン別の全作品スコアから median / p90 を事前計算 */
  const scoresBySeason = new Map<string, number[]>();
  // 全作品の重複（同一 work が複数キャストで出る）を排除してから集計
  const seenWork = new Set<string>();
  for (const row of rows) {
    const w = row.works as WorkRow;
    if (seenWork.has(w.id)) continue;
    seenWork.add(w.id);
    const score = resolveScore(w);
    const key = seasonKey(w);
    if (score == null || key == null) continue;
    if (!scoresBySeason.has(key)) scoresBySeason.set(key, []);
    scoresBySeason.get(key)!.push(score);
  }
  const seasonStats = buildSeasonStats(scoresBySeason);

  /* 2. 声優ごとに作品を集約（work_id で重複排除、sort は最小値を採用） */
  interface VaAccum {
    works: Map<string, { work: WorkRow; sort: number }>;
  }
  const vaMap = new Map<string, VaAccum>();
  for (const row of rows) {
    const name = row.person_name;
    if (!name) continue;
    if (!vaMap.has(name)) vaMap.set(name, { works: new Map() });
    const acc = vaMap.get(name)!;
    const sort = row.sort ?? 999;
    const existing = acc.works.get(row.work_id);
    if (!existing) {
      acc.works.set(row.work_id, { work: row.works as WorkRow, sort });
    } else if (sort < existing.sort) {
      existing.sort = sort; // 同一作品内では最上位の役を採用
    }
  }

  /* 3. スコアカード計算 */
  const cards: VaScorecard[] = [];

  for (const [name, acc] of vaMap) {
    const entries = [...acc.works.values()];
    const appearances = entries.length;

    const isLead = (sort: number) => sort <= 2;
    const leadAppearances = entries.filter((e) => isLead(e.sort)).length;
    const leadRatio =
      appearances > 0 ? Math.round((leadAppearances / appearances) * 100) / 100 : 0;

    // スコア付き作品
    const scoredPairs: { work: WorkRow; score: number; lead: boolean }[] = [];
    for (const e of entries) {
      const score = resolveScore(e.work);
      if (score != null) scoredPairs.push({ work: e.work, score, lead: isLead(e.sort) });
    }
    const scoredWorks = scoredPairs.length;
    if (scoredWorks < minWorks) continue; // ノイズフロア

    const scores = scoredPairs.map((p) => p.score);
    const avgScore = mean(scores);

    // 主演かつスコア付き
    const leadScores = scoredPairs.filter((p) => p.lead).map((p) => p.score);
    const leadAvgScore =
      leadScores.length > 0 ? Math.round(mean(leadScores) * 10) / 10 : null;

    // 打率（同クール中央値以上）
    const baPairs: { score: number; seasonMedian: number }[] = [];
    for (const { work, score } of scoredPairs) {
      const key = seasonKey(work);
      if (!key) continue;
      const st = seasonStats.get(key);
      if (!st) continue;
      baPairs.push({ score, seasonMedian: st.median });
    }
    const ba = baPairs.length > 0 ? battingAverage(baPairs) : NaN;

    // モメンタム（直近2年のスコア vs 通算）
    const recentScores: number[] = [];
    for (const { work, score } of scoredPairs) {
      if (work.season_year != null && work.season_year >= curYear - 1) {
        recentScores.push(score);
      }
    }
    const momentum = momentumDelta(recentScores, scores);

    // ブレイク（直近1年に主演かつ当該クールP90以上）
    let breakout = false;
    for (const { work, score, lead } of scoredPairs) {
      if (!lead) continue;
      if (work.season_year == null || work.season_year < curYear) continue;
      const key = seasonKey(work);
      if (!key) continue;
      const st = seasonStats.get(key);
      if (st && score >= st.p90) {
        breakout = true;
        break;
      }
    }

    cards.push({
      name,
      appearances,
      leadAppearances,
      leadRatio,
      scoredWorks,
      avgScore: Math.round(avgScore * 10) / 10,
      leadAvgScore,
      battingAverage: isNaN(ba) ? 0 : ba,
      momentum,
      breakout,
    });
  }

  /* 4. 注目度ソート: leadAvgScore 降順（null は最後）、同点は appearances 降順 */
  cards.sort((a, b) => {
    const av = a.leadAvgScore;
    const bv = b.leadAvgScore;
    if (av == null && bv == null) return b.appearances - a.appearances;
    if (av == null) return 1;
    if (bv == null) return -1;
    return bv - av || b.appearances - a.appearances;
  });

  return cards.slice(0, limit);
}

/**
 * 声優スコアカード（opts 単位で30分メモ化）。エクスポート名・挙動は従来どおり。
 * 全 work_casts × works を走査する重い集計をキャッシュする。
 */
export const getVoiceActorScorecards = memoizeTTL(
  getVoiceActorScorecardsUncached,
  (opts) => `va:${opts?.minWorks ?? 3}:${opts?.limit ?? 30}`,
  1800000,
);

/* ================================================================
   スタッフスコアカード
   ================================================================ */

interface RoleBucket {
  key: StaffRoleKey;
  label: string;
  keyword: string; // role 文字列に含まれていればマッチ
}

const ROLE_BUCKETS: RoleBucket[] = [
  { key: "director", label: "監督", keyword: "監督" },
  { key: "series", label: "シリーズ構成", keyword: "シリーズ構成" },
  { key: "chardesign", label: "キャラクターデザイン", keyword: "キャラクターデザイン" },
];

/**
 * スタッフスコアカードを返す（ロールバケット別）。
 * role は部分一致でバケットに振り分ける（Annict のロール文字列は対象キーワードを含む）。
 * 1人が複数バケットに該当しうる。バケット内では (person, bucket) を work_id で重複排除。
 *
 * @param opts.limit バケットあたりの上位N件（avgScore 降順）。デフォルト 15。
 */
async function getStaffScorecardsUncached(opts?: {
  limit?: number;
}): Promise<{ role: StaffRoleKey; label: string; people: StaffScorecard[] }[]> {
  const limit = opts?.limit ?? 15;
  const db = getAdminClient();

  const rows = await paginate<StaffWorkRow>((from) =>
    db
      .from("work_staff")
      .select(`person_name, role, work_id, works!inner(${SELECT_WORK})`)
      .not("person_name", "is", null)
      .neq("person_name", ""),
  );

  /* 1. シーズン別中央値（重複 work 排除） */
  const scoresBySeason = new Map<string, number[]>();
  const seenWork = new Set<string>();
  for (const row of rows) {
    const w = row.works as WorkRow;
    if (seenWork.has(w.id)) continue;
    seenWork.add(w.id);
    const score = resolveScore(w);
    const key = seasonKey(w);
    if (score == null || key == null) continue;
    if (!scoresBySeason.has(key)) scoresBySeason.set(key, []);
    scoresBySeason.get(key)!.push(score);
  }
  const seasonStats = buildSeasonStats(scoresBySeason);

  /* 2. バケット × 人物 ごとに作品集約（work_id 重複排除） */
  // bucketKey → person → Map<work_id, WorkRow>
  const buckets = new Map<StaffRoleKey, Map<string, Map<string, WorkRow>>>();
  for (const b of ROLE_BUCKETS) buckets.set(b.key, new Map());

  for (const row of rows) {
    const name = row.person_name;
    if (!name || !row.role) continue;
    for (const b of ROLE_BUCKETS) {
      if (!row.role.includes(b.keyword)) continue;
      const byPerson = buckets.get(b.key)!;
      if (!byPerson.has(name)) byPerson.set(name, new Map());
      const works = byPerson.get(name)!;
      if (!works.has(row.work_id)) works.set(row.work_id, row.works as WorkRow);
    }
  }

  /* 3. バケットごとにスコアカード計算 */
  const result: { role: StaffRoleKey; label: string; people: StaffScorecard[] }[] = [];

  for (const b of ROLE_BUCKETS) {
    const byPerson = buckets.get(b.key)!;
    const people: StaffScorecard[] = [];

    for (const [name, worksMap] of byPerson) {
      const allWorks = [...worksMap.values()];
      const works = allWorks.length;

      const scoredPairs: { work: WorkRow; score: number }[] = [];
      for (const w of allWorks) {
        const score = resolveScore(w);
        if (score != null) scoredPairs.push({ work: w, score });
      }
      const scoredWorks = scoredPairs.length;
      if (scoredWorks < 2) continue; // ノイズフロア

      const scores = scoredPairs.map((p) => p.score);
      const avgScore = mean(scores);

      // 一貫性
      let consistency: number | null = null;
      if (scoredWorks >= 2) {
        const cv = coefficientOfVariation(scores);
        consistency = isFinite(cv) ? consistencyFromCv(cv) : null;
      }

      // 打率
      const baPairs: { score: number; seasonMedian: number }[] = [];
      for (const { work, score } of scoredPairs) {
        const key = seasonKey(work);
        if (!key) continue;
        const st = seasonStats.get(key);
        if (!st) continue;
        baPairs.push({ score, seasonMedian: st.median });
      }
      const ba = baPairs.length > 0 ? battingAverage(baPairs) : NaN;

      // 年別トレンド（直近4年）
      const scoresByYear = new Map<number, number[]>();
      for (const { work, score } of scoredPairs) {
        if (work.season_year == null) continue;
        if (!scoresByYear.has(work.season_year)) scoresByYear.set(work.season_year, []);
        scoresByYear.get(work.season_year)!.push(score);
      }
      const years = [...scoresByYear.keys()].sort((a, b) => a - b).slice(-4);
      const yearTrend: StaffYearAvg[] = years.map((year) => ({
        year,
        avgScore: Math.round(mean(scoresByYear.get(year)!) * 10) / 10,
      }));

      people.push({
        name,
        works,
        scoredWorks,
        avgScore: Math.round(avgScore * 10) / 10,
        consistency,
        battingAverage: isNaN(ba) ? 0 : ba,
        yearTrend,
      });
    }

    people.sort((a, b) => b.avgScore - a.avgScore || b.works - a.works);
    result.push({ role: b.key, label: b.label, people: people.slice(0, limit) });
  }

  return result;
}

/**
 * スタッフスコアカード（opts 単位で30分メモ化）。エクスポート名・挙動は従来どおり。
 * 全 work_staff × works を走査する重い集計をキャッシュする。
 */
export const getStaffScorecards = memoizeTTL(
  getStaffScorecardsUncached,
  (opts) => `staff:${opts?.limit ?? 15}`,
  1800000,
);
