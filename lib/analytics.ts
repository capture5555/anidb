import { getAdminClient } from "./supabase/admin";
import { SEASON_ORDER } from "./season";
import type { Season } from "./types";

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
export interface PopularWork {
  id: string;
  title: string;
  popularity: number;
  season_name: Season | null;
  posterUrl: string | null;
}

export async function getStudioStats(limit = 25): Promise<StudioStat[]> {
  const db = getAdminClient();
  const { data } = await db
    .from("v_studio_stats")
    .select("*")
    .order("work_count", { ascending: false })
    .limit(limit);
  return (data as StudioStat[]) ?? [];
}

export async function getVaRanking(limit = 30): Promise<VaStat[]> {
  const db = getAdminClient();
  const { data } = await db
    .from("v_va_ranking")
    .select("*")
    .order("work_count", { ascending: false })
    .limit(limit);
  return (data as VaStat[]) ?? [];
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

export async function getPopularByYear(year: number, limit = 10): Promise<PopularWork[]> {
  const db = getAdminClient();
  const { data } = await db
    .from("works")
    .select("id, title, popularity, season_name, poster_url, key_visual_url")
    .eq("season_year", year)
    .order("popularity", { ascending: false })
    .limit(limit);
  return (data ?? []).map((w: any) => ({
    id: w.id,
    title: w.title,
    popularity: w.popularity,
    season_name: w.season_name,
    posterUrl: w.poster_url ?? w.key_visual_url,
  }));
}

/** データのある年の一覧（降順） */
export async function getYears(): Promise<number[]> {
  const vol = await getSeasonVolume();
  return [...new Set(vol.map((v) => v.season_year))].sort((a, b) => b - a);
}
