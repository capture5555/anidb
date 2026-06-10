import type { Season } from "./types.ts";

export const SEASON_LABELS: Record<Season, string> = {
  winter: "冬",
  spring: "春",
  summer: "夏",
  autumn: "秋",
};

export const SEASON_ORDER: Season[] = ["winter", "spring", "summer", "autumn"];

/** 月(1-12) → シーズン */
export function monthToSeason(month: number): Season {
  if (month <= 3) return "winter";
  if (month <= 6) return "spring";
  if (month <= 9) return "summer";
  return "autumn";
}

/** ある日時の「今シーズン」を返す */
export function seasonOf(date: Date): { year: number; season: Season } {
  return { year: date.getFullYear(), season: monthToSeason(date.getMonth() + 1) };
}

/** 次のシーズン */
export function nextSeason(year: number, season: Season): { year: number; season: Season } {
  const idx = SEASON_ORDER.indexOf(season);
  if (idx === SEASON_ORDER.length - 1) return { year: year + 1, season: SEASON_ORDER[0] };
  return { year, season: SEASON_ORDER[idx + 1] };
}

/** "2026-spring" 形式へ */
export function seasonSlug(year: number, season: Season): string {
  return `${year}-${season}`;
}

export function parseSeasonSlug(slug: string): { year: number; season: Season } | null {
  const m = slug.match(/^(\d{4})-(winter|spring|summer|autumn)$/);
  if (!m) return null;
  return { year: Number(m[1]), season: m[2] as Season };
}

export function formatSeason(year: number | null, season: Season | null): string {
  if (!year || !season) return "放送時期未定";
  return `${year}年 ${SEASON_LABELS[season]}`;
}
