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
import { fromSnapshotOrLive } from "./snapshots.ts";

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
export async function getVoiceActorScorecardsUncached(opts?: {
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

/** 声優スコアカードの LIVE 計算（opts 単位で30分メモ化）。 */
const getVoiceActorScorecardsLive = memoizeTTL(
  getVoiceActorScorecardsUncached,
  (opts) => `va:${opts?.minWorks ?? 3}:${opts?.limit ?? 30}`,
  1800000,
);

/**
 * 声優スコアカード。エクスポート名・挙動は従来どおり。
 * デフォルト opts（minWorks=3, limit=30）のときだけ事前計算スナップショットを使い、
 * 非デフォルト opts のときは LIVE 計算する。スナップショット欠如時も LIVE へフォールバック。
 */
export function getVoiceActorScorecards(opts?: {
  minWorks?: number;
  limit?: number;
}): Promise<VaScorecard[]> {
  const minWorks = opts?.minWorks ?? 3;
  const limit = opts?.limit ?? 30;
  const isDefault = minWorks === 3 && limit === 30;
  if (!isDefault) return getVoiceActorScorecardsLive(opts);
  return fromSnapshotOrLive("va_scorecards", () => getVoiceActorScorecardsLive(opts));
}

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
export async function getStaffScorecardsUncached(opts?: {
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

/** スタッフスコアカードの LIVE 計算（opts 単位で30分メモ化）。 */
const getStaffScorecardsLive = memoizeTTL(
  getStaffScorecardsUncached,
  (opts) => `staff:${opts?.limit ?? 15}`,
  1800000,
);

/**
 * スタッフスコアカード。エクスポート名・挙動は従来どおり。
 * デフォルト opts（limit=15）のときだけ事前計算スナップショットを使い、
 * 非デフォルト opts のときは LIVE 計算する。スナップショット欠如時も LIVE へフォールバック。
 */
export function getStaffScorecards(opts?: {
  limit?: number;
}): Promise<{ role: StaffRoleKey; label: string; people: StaffScorecard[] }[]> {
  const limit = opts?.limit ?? 15;
  const isDefault = limit === 15;
  if (!isDefault) return getStaffScorecardsLive(opts);
  return fromSnapshotOrLive("staff_scorecards", () => getStaffScorecardsLive(opts));
}

/* ================================================================
   個人詳細（単一人物のドリルダウン）
   ================================================================ */

/** season_year+season_name の新しさで比較するためのソートキー */
const SEASON_RANK_DETAIL: Record<string, number> = {
  winter: 0,
  spring: 1,
  summer: 2,
  autumn: 3,
};

function sortSeasonDesc(
  a: { seasonYear: number | null; seasonName: string | null },
  b: { seasonYear: number | null; seasonName: string | null },
): number {
  const ay = a.seasonYear ?? -Infinity;
  const by = b.seasonYear ?? -Infinity;
  if (ay !== by) return by - ay;
  const ar = a.seasonName ? (SEASON_RANK_DETAIL[a.seasonName] ?? -1) : -1;
  const br = b.seasonName ? (SEASON_RANK_DETAIL[b.seasonName] ?? -1) : -1;
  return br - ar;
}

/** 詳細ページ用の参加作品1件（共通） */
export interface PersonWork {
  workId: string;
  title: string;
  posterUrl: string | null;
  seasonYear: number | null;
  seasonName: string | null;
  score: number | null;
  popularity: number | null;
  /** 声優: 役名、スタッフ: ロール文字列 */
  roleOrCharacter: string | null;
  /** 声優のみ: 主演かどうか（sort <= 2） */
  isLead?: boolean;
}

/** 年別・打率を含む推移エントリ */
export interface PersonYearStat {
  year: number;
  avgScore: number;
  works: number;
  battingAverage: number;
}

/** 共演・協業の多い相手 */
export interface PersonCoWork {
  name: string;
  /** 共通作品数 */
  count: number;
  /** 個人ページへのリンク用パス（va or staff） */
  type: "va" | "staff";
}

/** 声優詳細 */
export interface VoiceActorDetail {
  name: string;
  worksCount: number;
  scoredWorks: number;
  avgScore: number;
  leadAvgScore: number | null;
  battingAverage: number;
  momentum: number | null;
  works: PersonWork[];
  yearStats: PersonYearStat[];
  highlights: PersonWork[];
  coActors: PersonCoWork[];
  coStaff: PersonCoWork[];
}

/** スタッフ詳細 */
export interface StaffDetail {
  name: string;
  worksCount: number;
  scoredWorks: number;
  avgScore: number;
  battingAverage: number;
  roles: string[];
  works: PersonWork[];
  yearStats: PersonYearStat[];
  highlights: PersonWork[];
  coActors: PersonCoWork[];
  coStaff: PersonCoWork[];
}

/** 詳細ページ用の拡張 works 行 */
interface DetailWorkRowFull {
  id: string;
  title: string;
  poster_url: string | null;
  key_visual_url: string | null;
  season_year: number | null;
  season_name: string | null;
  anilist_score: number | null;
  mal_score: number | null;
  popularity: number | null;
}

interface DetailCastRow {
  person_name: string;
  work_id: string;
  sort: number | null;
  character_name: string | null;
  works: DetailWorkRowFull;
}

interface DetailStaffRowFull {
  person_name: string;
  work_id: string;
  role: string;
  works: DetailWorkRowFull;
}

const SELECT_DETAIL_WORK =
  "id, title, poster_url, key_visual_url, season_year, season_name, anilist_score, mal_score, popularity";

function resolveDetailScore(w: DetailWorkRowFull): number | null {
  if (w.anilist_score != null) return w.anilist_score;
  if (w.mal_score != null) return Math.round(Number(w.mal_score) * 10);
  return null;
}

/** クール別の全作品スコア中央値を計算（打率の分母）。
 *  seasonKeys が空なら空 Map を返す（DB を叩かない）。 */
async function buildSeasonMedianMap(
  db: ReturnType<typeof getAdminClient>,
  seasonKeys: Set<string>,
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (seasonKeys.size === 0) return out;
  try {
    const scoresBySeason = new Map<string, number[]>();
    const seen = new Set<string>();
    // 関連シーズンのみ全作品スコアを取得（work_staffからanimation-productionクレジットで代用）
    for (const key of seasonKeys) {
      const [yearStr, seasonName] = key.split("|");
      for (let from = 0; ; from += 1000) {
        const { data, error } = await db
          .from("works")
          .select("id, season_year, season_name, anilist_score, mal_score")
          .eq("season_year", Number(yearStr))
          .eq("season_name", seasonName)
          .range(from, from + 999);
        if (error) throw error;
        const batch = (data ?? []) as { id: string; season_year: number | null; season_name: string | null; anilist_score: number | null; mal_score: number | null }[];
        for (const w of batch) {
          if (seen.has(w.id)) continue;
          seen.add(w.id);
          const sc = w.anilist_score ?? (w.mal_score != null ? Math.round(Number(w.mal_score) * 10) : null);
          if (sc == null || !w.season_year || !w.season_name) continue;
          const k = `${w.season_year}|${w.season_name}`;
          if (!scoresBySeason.has(k)) scoresBySeason.set(k, []);
          scoresBySeason.get(k)!.push(sc);
        }
        if (!data || data.length < 1000) break;
      }
    }
    for (const [k, arr] of scoresBySeason) out.set(k, median(arr));
  } catch {
    // 打率が計算できなくても続行
    out.clear();
  }
  return out;
}

/**
 * 声優の詳細情報を返す（15分メモ化・防御的）。
 * 見つからなければ null。DB例外も握りつぶして null。
 */
async function getVoiceActorDetailUncached(name: string): Promise<VoiceActorDetail | null> {
  const trimmed = name.trim();
  if (!trimmed) return null;

  const db = getAdminClient();

  try {
    // 1. この声優のキャスト行を全取得
    const castRows: DetailCastRow[] = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await db
        .from("work_casts")
        .select(
          `person_name, work_id, sort, character_name, works!inner(${SELECT_DETAIL_WORK})`,
        )
        .eq("person_name", trimmed)
        .range(from, from + 999);
      if (error) throw error;
      castRows.push(...((data ?? []) as unknown as DetailCastRow[]));
      if (!data || data.length < 1000) break;
    }
    if (castRows.length === 0) return null;

    // 2. work_id で重複排除（同一作品内では sort 最小値を採用）
    const worksById = new Map<string, { work: DetailWorkRowFull; sort: number; character: string | null }>();
    for (const row of castRows) {
      const sort = row.sort ?? 999;
      const existing = worksById.get(row.work_id);
      if (!existing) {
        worksById.set(row.work_id, { work: row.works, sort, character: row.character_name ?? null });
      } else if (sort < existing.sort) {
        existing.sort = sort;
        if (row.character_name) existing.character = row.character_name;
      }
    }

    const allEntries = [...worksById.values()];
    const worksCount = allEntries.length;
    const isLead = (sort: number) => sort <= 2;

    // スコア付き
    const scoredPairs: { work: DetailWorkRowFull; score: number; lead: boolean; character: string | null }[] = [];
    for (const e of allEntries) {
      const score = resolveDetailScore(e.work);
      if (score != null) scoredPairs.push({ work: e.work, score, lead: isLead(e.sort), character: e.character });
    }
    const scoredWorks = scoredPairs.length;
    const scores = scoredPairs.map((p) => p.score);
    const avgScore = scores.length > 0 ? Math.round(mean(scores) * 10) / 10 : 0;

    const leadScores = scoredPairs.filter((p) => p.lead).map((p) => p.score);
    const leadAvgScore = leadScores.length > 0 ? Math.round(mean(leadScores) * 10) / 10 : null;

    // モメンタム
    const curYear = new Date().getFullYear();
    const recentScores = scoredPairs
      .filter((p) => p.work.season_year != null && p.work.season_year >= curYear - 1)
      .map((p) => p.score);
    const momentum = momentumDelta(recentScores, scores);

    // 打率
    const seasonKeys = new Set<string>();
    for (const { work } of scoredPairs) {
      if (work.season_year && work.season_name) seasonKeys.add(`${work.season_year}|${work.season_name}`);
    }
    const seasonMedianMap = await buildSeasonMedianMap(db, seasonKeys);
    const baPairs: { score: number; seasonMedian: number }[] = [];
    for (const { work, score } of scoredPairs) {
      if (!work.season_year || !work.season_name) continue;
      const med = seasonMedianMap.get(`${work.season_year}|${work.season_name}`);
      if (med == null) continue;
      baPairs.push({ score, seasonMedian: med });
    }
    const ba = baPairs.length > 0 ? battingAverage(baPairs) : NaN;

    // 年別推移
    const scoresByYear = new Map<number, number[]>();
    for (const { work, score } of scoredPairs) {
      if (!work.season_year) continue;
      if (!scoresByYear.has(work.season_year)) scoresByYear.set(work.season_year, []);
      scoresByYear.get(work.season_year)!.push(score);
    }
    const yearStats: PersonYearStat[] = [...scoresByYear.keys()]
      .sort((a, b) => a - b)
      .map((year) => {
        const ys = scoresByYear.get(year)!;
        // 打率（該当年のシーズン内）
        const yBaPairs: { score: number; seasonMedian: number }[] = [];
        for (const { work, score } of scoredPairs) {
          if (work.season_year !== year || !work.season_name) continue;
          const med = seasonMedianMap.get(`${work.season_year}|${work.season_name}`);
          if (med == null) continue;
          yBaPairs.push({ score, seasonMedian: med });
        }
        const yBa = yBaPairs.length > 0 ? battingAverage(yBaPairs) : 0;
        return {
          year,
          avgScore: Math.round(mean(ys) * 10) / 10,
          works: ys.length,
          battingAverage: yBa,
        };
      });

    // 作品一覧（新しいクール順）
    const works: PersonWork[] = allEntries
      .map((e) => ({
        workId: e.work.id,
        title: e.work.title,
        posterUrl: e.work.poster_url ?? e.work.key_visual_url ?? null,
        seasonYear: e.work.season_year,
        seasonName: e.work.season_name,
        score: resolveDetailScore(e.work),
        popularity: e.work.popularity,
        roleOrCharacter: e.character,
        isLead: isLead(e.sort),
      }))
      .sort((a, b) => {
        const s = sortSeasonDesc(a, b);
        if (s !== 0) return s;
        const as = a.score ?? -Infinity;
        const bs = b.score ?? -Infinity;
        return bs - as;
      });

    // ハイライト（スコア上位3 + 人気上位1 重複除去）
    const highlightWorkIds: string[] = [
      ...scoredPairs
        .slice()
        .sort((a, b) => b.score - a.score)
        .slice(0, 3)
        .map((p) => p.work.id),
      ...[...allEntries]
        .filter((e) => e.work.popularity != null)
        .sort((a, b) => (b.work.popularity ?? 0) - (a.work.popularity ?? 0))
        .slice(0, 1)
        .map((e) => e.work.id),
    ];
    const highlightIds = new Set<string>();
    const highlights: PersonWork[] = [];
    for (const wid of highlightWorkIds) {
      if (highlightIds.has(wid)) continue;
      highlightIds.add(wid);
      const entry = worksById.get(wid);
      if (!entry) continue;
      const w = entry.work;
      highlights.push({
        workId: w.id,
        title: w.title,
        posterUrl: w.poster_url ?? w.key_visual_url ?? null,
        seasonYear: w.season_year,
        seasonName: w.season_name,
        score: resolveDetailScore(w),
        popularity: w.popularity,
        roleOrCharacter: entry.character ?? null,
        isLead: isLead(entry.sort),
      });
    }

    // 共演者カウント（同じ作品に出ている他の声優）
    const workIdSet = new Set(allEntries.map((e) => e.work.id));
    const coActorCount = new Map<string, number>();
    try {
      const coRows: { person_name: string; work_id: string }[] = [];
      for (let from = 0; ; from += 1000) {
        const { data, error } = await db
          .from("work_casts")
          .select("person_name, work_id")
          .in("work_id", [...workIdSet])
          .neq("person_name", trimmed)
          .not("person_name", "is", null)
          .range(from, from + 999);
        if (error) throw error;
        coRows.push(...((data ?? []) as { person_name: string; work_id: string }[]));
        if (!data || data.length < 1000) break;
      }
      // (person_name, work_id) で重複排除してカウント
      const seen = new Set<string>();
      for (const r of coRows) {
        const key = `${r.person_name}|${r.work_id}`;
        if (seen.has(key)) continue;
        seen.add(key);
        coActorCount.set(r.person_name, (coActorCount.get(r.person_name) ?? 0) + 1);
      }
    } catch {
      // 共演者取得失敗は握りつぶす
    }
    const coActors: PersonCoWork[] = [...coActorCount.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([n, count]) => ({ name: n, count, type: "va" as const }));

    // 共演スタッフ（同じ作品の監督・シリーズ構成・キャラデザ）
    const coStaffCount = new Map<string, number>();
    try {
      const sfRows: { person_name: string; work_id: string }[] = [];
      for (let from = 0; ; from += 1000) {
        const { data, error } = await db
          .from("work_staff")
          .select("person_name, work_id")
          .in("work_id", [...workIdSet])
          .not("person_name", "is", null)
          .neq("person_name", "")
          .or("role.ilike.%監督%,role.ilike.%シリーズ構成%,role.ilike.%キャラクターデザイン%")
          .range(from, from + 999);
        if (error) throw error;
        sfRows.push(...((data ?? []) as { person_name: string; work_id: string }[]));
        if (!data || data.length < 1000) break;
      }
      const seen = new Set<string>();
      for (const r of sfRows) {
        if (!r.person_name) continue;
        const key = `${r.person_name}|${r.work_id}`;
        if (seen.has(key)) continue;
        seen.add(key);
        coStaffCount.set(r.person_name, (coStaffCount.get(r.person_name) ?? 0) + 1);
      }
    } catch {
      // 握りつぶす
    }
    const coStaff: PersonCoWork[] = [...coStaffCount.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([n, count]) => ({ name: n, count, type: "staff" as const }));

    return {
      name: trimmed,
      worksCount,
      scoredWorks,
      avgScore,
      leadAvgScore,
      battingAverage: isNaN(ba) ? 0 : ba,
      momentum,
      works,
      yearStats,
      highlights,
      coActors,
      coStaff,
    };
  } catch {
    return null;
  }
}

/** 声優の詳細を返す（15分メモ化・防御的）。*/
export const getVoiceActorDetail = memoizeTTL(
  async (name: string): Promise<VoiceActorDetail | null> => {
    try {
      return await getVoiceActorDetailUncached(name);
    } catch {
      return null;
    }
  },
  (name) => `va_detail:${name}`,
  900000,
);

/**
 * スタッフの詳細情報を返す（15分メモ化・防御的）。
 * 見つからなければ null。DB例外も握りつぶして null。
 */
async function getStaffDetailUncached(name: string): Promise<StaffDetail | null> {
  const trimmed = name.trim();
  if (!trimmed) return null;

  const db = getAdminClient();

  try {
    // 1. このスタッフの全ロール行を取得
    const staffRows: DetailStaffRowFull[] = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await db
        .from("work_staff")
        .select(
          `person_name, work_id, role, works!inner(${SELECT_DETAIL_WORK})`,
        )
        .eq("person_name", trimmed)
        .range(from, from + 999);
      if (error) throw error;
      staffRows.push(...((data ?? []) as unknown as DetailStaffRowFull[]));
      if (!data || data.length < 1000) break;
    }
    if (staffRows.length === 0) return null;

    // 2. work_id で重複排除（roles は蓄積）
    const worksById = new Map<string, { work: DetailWorkRowFull; roles: Set<string> }>();
    for (const row of staffRows) {
      if (!worksById.has(row.work_id)) {
        worksById.set(row.work_id, { work: row.works, roles: new Set() });
      }
      if (row.role) worksById.get(row.work_id)!.roles.add(row.role);
    }

    const allEntries = [...worksById.values()];
    const worksCount = allEntries.length;

    // ロール一覧（ユニーク）
    const allRoles = new Set<string>();
    for (const { roles } of allEntries) roles.forEach((r) => allRoles.add(r));
    const roles = [...allRoles].sort();

    // スコア付き
    const scoredPairs: { work: DetailWorkRowFull; score: number; roles: Set<string> }[] = [];
    for (const e of allEntries) {
      const score = resolveDetailScore(e.work);
      if (score != null) scoredPairs.push({ work: e.work, score, roles: e.roles });
    }
    const scoredWorks = scoredPairs.length;
    const scores = scoredPairs.map((p) => p.score);
    const avgScore = scores.length > 0 ? Math.round(mean(scores) * 10) / 10 : 0;

    // 打率
    const seasonKeys = new Set<string>();
    for (const { work } of scoredPairs) {
      if (work.season_year && work.season_name) seasonKeys.add(`${work.season_year}|${work.season_name}`);
    }
    const seasonMedianMap = await buildSeasonMedianMap(db, seasonKeys);
    const baPairs: { score: number; seasonMedian: number }[] = [];
    for (const { work, score } of scoredPairs) {
      if (!work.season_year || !work.season_name) continue;
      const med = seasonMedianMap.get(`${work.season_year}|${work.season_name}`);
      if (med == null) continue;
      baPairs.push({ score, seasonMedian: med });
    }
    const ba = baPairs.length > 0 ? battingAverage(baPairs) : NaN;

    // 年別推移
    const scoresByYear = new Map<number, number[]>();
    for (const { work, score } of scoredPairs) {
      if (!work.season_year) continue;
      if (!scoresByYear.has(work.season_year)) scoresByYear.set(work.season_year, []);
      scoresByYear.get(work.season_year)!.push(score);
    }
    const yearStats: PersonYearStat[] = [...scoresByYear.keys()]
      .sort((a, b) => a - b)
      .map((year) => {
        const ys = scoresByYear.get(year)!;
        const yBaPairs: { score: number; seasonMedian: number }[] = [];
        for (const { work, score } of scoredPairs) {
          if (work.season_year !== year || !work.season_name) continue;
          const med = seasonMedianMap.get(`${work.season_year}|${work.season_name}`);
          if (med == null) continue;
          yBaPairs.push({ score, seasonMedian: med });
        }
        const yBa = yBaPairs.length > 0 ? battingAverage(yBaPairs) : 0;
        return {
          year,
          avgScore: Math.round(mean(ys) * 10) / 10,
          works: ys.length,
          battingAverage: yBa,
        };
      });

    // 作品一覧（新しいクール順）
    const works: PersonWork[] = allEntries
      .map((e) => ({
        workId: e.work.id,
        title: e.work.title,
        posterUrl: e.work.poster_url ?? e.work.key_visual_url ?? null,
        seasonYear: e.work.season_year,
        seasonName: e.work.season_name,
        score: resolveDetailScore(e.work),
        popularity: e.work.popularity,
        roleOrCharacter: [...e.roles].join(" / ") || null,
        isLead: undefined,
      }))
      .sort((a, b) => {
        const s = sortSeasonDesc(a, b);
        if (s !== 0) return s;
        const as = a.score ?? -Infinity;
        const bs = b.score ?? -Infinity;
        return bs - as;
      });

    // ハイライト
    const highlightWorkIdsStaff: string[] = [
      ...scoredPairs
        .slice()
        .sort((a, b) => b.score - a.score)
        .slice(0, 3)
        .map((p) => p.work.id),
      ...[...allEntries]
        .filter((e) => e.work.popularity != null)
        .sort((a, b) => (b.work.popularity ?? 0) - (a.work.popularity ?? 0))
        .slice(0, 1)
        .map((e) => e.work.id),
    ];
    const highlightIds = new Set<string>();
    const highlights: PersonWork[] = [];
    for (const wid of highlightWorkIdsStaff) {
      if (highlightIds.has(wid)) continue;
      highlightIds.add(wid);
      const entry = worksById.get(wid);
      if (!entry) continue;
      const w = entry.work;
      highlights.push({
        workId: w.id,
        title: w.title,
        posterUrl: w.poster_url ?? w.key_visual_url ?? null,
        seasonYear: w.season_year,
        seasonName: w.season_name,
        score: resolveDetailScore(w),
        popularity: w.popularity,
        roleOrCharacter: [...entry.roles].join(" / ") || null,
      });
    }

    // 共演声優
    const workIdSet = new Set(allEntries.map((e) => e.work.id));
    const coActorCount = new Map<string, number>();
    try {
      const coRows: { person_name: string; work_id: string }[] = [];
      for (let from = 0; ; from += 1000) {
        const { data, error } = await db
          .from("work_casts")
          .select("person_name, work_id")
          .in("work_id", [...workIdSet])
          .not("person_name", "is", null)
          .range(from, from + 999);
        if (error) throw error;
        coRows.push(...((data ?? []) as { person_name: string; work_id: string }[]));
        if (!data || data.length < 1000) break;
      }
      const seen = new Set<string>();
      for (const r of coRows) {
        if (!r.person_name) continue;
        const key = `${r.person_name}|${r.work_id}`;
        if (seen.has(key)) continue;
        seen.add(key);
        coActorCount.set(r.person_name, (coActorCount.get(r.person_name) ?? 0) + 1);
      }
    } catch {
      // 握りつぶす
    }
    const coActors: PersonCoWork[] = [...coActorCount.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([n, count]) => ({ name: n, count, type: "va" as const }));

    // 共演スタッフ
    const coStaffCount = new Map<string, number>();
    try {
      const sfRows: { person_name: string; work_id: string }[] = [];
      for (let from = 0; ; from += 1000) {
        const { data, error } = await db
          .from("work_staff")
          .select("person_name, work_id")
          .in("work_id", [...workIdSet])
          .neq("person_name", trimmed)
          .not("person_name", "is", null)
          .neq("person_name", "")
          .or("role.ilike.%監督%,role.ilike.%シリーズ構成%,role.ilike.%キャラクターデザイン%")
          .range(from, from + 999);
        if (error) throw error;
        sfRows.push(...((data ?? []) as { person_name: string; work_id: string }[]));
        if (!data || data.length < 1000) break;
      }
      const seen = new Set<string>();
      for (const r of sfRows) {
        if (!r.person_name) continue;
        const key = `${r.person_name}|${r.work_id}`;
        if (seen.has(key)) continue;
        seen.add(key);
        coStaffCount.set(r.person_name, (coStaffCount.get(r.person_name) ?? 0) + 1);
      }
    } catch {
      // 握りつぶす
    }
    const coStaff: PersonCoWork[] = [...coStaffCount.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([n, count]) => ({ name: n, count, type: "staff" as const }));

    return {
      name: trimmed,
      worksCount,
      scoredWorks,
      avgScore,
      battingAverage: isNaN(ba) ? 0 : ba,
      roles,
      works,
      yearStats,
      highlights,
      coActors,
      coStaff,
    };
  } catch {
    return null;
  }
}

/** スタッフの詳細を返す（15分メモ化・防御的）。*/
export const getStaffDetailFn = memoizeTTL(
  async (name: string): Promise<StaffDetail | null> => {
    try {
      return await getStaffDetailUncached(name);
    } catch {
      return null;
    }
  },
  (name) => `staff_detail:${name}`,
  900000,
);
