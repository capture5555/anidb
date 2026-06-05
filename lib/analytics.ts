import { getAdminClient } from "./supabase/admin";
import { SEASON_ORDER } from "./season";
import type { Season } from "./types";

// 集計対象の絞り込み（期間）。空＝全期間。
export interface Filter {
  sinceYear?: number; // この年以降
  year?: number; // 特定年（クール指定用）
  season?: Season; // 特定クール
}

export interface StudioStat {
  studio: string;
  work_count: number;
  avg_popularity: number;
}
export interface VaStat {
  person_name: string;
  work_count: number;
}
export interface SeasonVolume {
  season_year: number;
  season_name: Season;
  work_count: number;
}
export interface RatedWork {
  id: string;
  title: string;
  posterUrl: string | null;
  season_year: number | null;
  season_name: Season | null;
  popularity: number;
  anilist_score: number | null;
  mal_score: number | null;
}

const isAll = (f: Filter) => !f.sinceYear && !f.year && !f.season;

/** works への絞り込みを適用（直接テーブル / 埋め込みの両対応。prefixは "works." 等） */
function applyFilter<T>(q: T, f: Filter, prefix = ""): T {
  const col = (c: string) => `${prefix}${c}`;
  let r: any = q;
  if (f.year) r = r.eq(col("season_year"), f.year);
  if (f.season) r = r.eq(col("season_name"), f.season);
  if (f.sinceYear) r = r.gte(col("season_year"), f.sinceYear);
  return r as T;
}

async function paginate(build: (from: number) => any): Promise<any[]> {
  const out: any[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await build(from).range(from, from + 999);
    if (error) throw error;
    out.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  return out;
}

export async function getStudioStats(filter: Filter, limit = 25): Promise<StudioStat[]> {
  const db = getAdminClient();
  if (isAll(filter)) {
    const { data } = await db
      .from("v_studio_stats")
      .select("*")
      .order("work_count", { ascending: false })
      .limit(limit);
    return (data as StudioStat[]) ?? [];
  }
  // 期間指定: 基テーブルから集計
  const rows = await paginate((from) =>
    applyFilter(
      db
        .from("work_staff")
        .select("person_name, works!inner(popularity, season_year, season_name)")
        .eq("role", "アニメーション制作"),
      filter,
      "works.",
    ),
  );
  const m = new Map<string, { n: number; pop: number }>();
  for (const r of rows) {
    const name = r.person_name;
    if (!name) continue;
    const c = m.get(name) ?? { n: 0, pop: 0 };
    c.n++;
    c.pop += r.works?.popularity ?? 0;
    m.set(name, c);
  }
  return [...m.entries()]
    .map(([studio, c]) => ({ studio, work_count: c.n, avg_popularity: Math.round(c.pop / c.n) }))
    .sort((a, b) => b.work_count - a.work_count)
    .slice(0, limit);
}

export async function getVaRanking(filter: Filter, limit = 30): Promise<VaStat[]> {
  const db = getAdminClient();
  if (isAll(filter)) {
    const { data } = await db
      .from("v_va_ranking")
      .select("*")
      .order("work_count", { ascending: false })
      .limit(limit);
    return (data as VaStat[]) ?? [];
  }
  const rows = await paginate((from) =>
    applyFilter(
      db.from("work_casts").select("person_name, work_id, works!inner(season_year, season_name)"),
      filter,
      "works.",
    ),
  );
  const m = new Map<string, Set<string>>();
  for (const r of rows) {
    if (!r.person_name) continue;
    if (!m.has(r.person_name)) m.set(r.person_name, new Set());
    m.get(r.person_name)!.add(r.work_id);
  }
  return [...m.entries()]
    .map(([person_name, set]) => ({ person_name, work_count: set.size }))
    .sort((a, b) => b.work_count - a.work_count)
    .slice(0, limit);
}

export async function getSeasonVolume(): Promise<SeasonVolume[]> {
  const db = getAdminClient();
  const { data } = await db.from("v_season_volume").select("*");
  const rows = (data as SeasonVolume[]) ?? [];
  return rows.sort(
    (a, b) =>
      a.season_year - b.season_year ||
      SEASON_ORDER.indexOf(a.season_name) - SEASON_ORDER.indexOf(b.season_name),
  );
}

const RATED_SELECT = "id, title, poster_url, key_visual_url, season_year, season_name, popularity, anilist_score, mal_score";
function mapRated(w: any): RatedWork {
  return {
    id: w.id,
    title: w.title,
    posterUrl: w.poster_url ?? w.key_visual_url,
    season_year: w.season_year,
    season_name: w.season_name,
    popularity: w.popularity ?? 0,
    anilist_score: w.anilist_score ?? null,
    mal_score: w.mal_score != null ? Number(w.mal_score) : null,
  };
}

export async function getPopular(filter: Filter, limit = 12): Promise<RatedWork[]> {
  const db = getAdminClient();
  let q = db.from("works").select(RATED_SELECT).order("popularity", { ascending: false }).limit(limit);
  q = applyFilter(q, filter);
  const { data } = await q;
  return (data ?? []).map(mapRated);
}

/** 高評価ランキング。metric: anilist(0-100) / mal(0-10) */
export async function getTopRated(
  filter: Filter,
  metric: "anilist" | "mal",
  limit = 12,
): Promise<RatedWork[]> {
  const db = getAdminClient();
  const col = metric === "anilist" ? "anilist_score" : "mal_score";
  let q = db
    .from("works")
    .select(RATED_SELECT)
    .not(col, "is", null)
    .order(col, { ascending: false })
    .limit(limit);
  // MALは評価数が少ないと不安定なので最低件数で足切り
  if (metric === "mal") q = q.gte("mal_scored_by", 500);
  q = applyFilter(q, filter);
  const { data } = await q;
  return (data ?? []).map(mapRated);
}

export async function getYears(): Promise<number[]> {
  const vol = await getSeasonVolume();
  return [...new Set(vol.map((v) => v.season_year))].sort((a, b) => b - a);
}
