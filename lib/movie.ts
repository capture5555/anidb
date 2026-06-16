// ============================================================
//  映画（劇場アニメ）の上映ステータス・公開日ユーティリティ
//  ------------------------------------------------------------
//  映画は「放送中/放送予定」ではなく「上映中/近日上映開始/上映予定/上映終了」で
//  扱う。公開日(released_on)を基準に現在時刻から判定する。
//  公開日が未取得の場合は season から近似する（feed.ts と共通ロジック）。
// ============================================================

import type { Season } from "./types.ts";

/** 公開日判定に必要な最小フィールド。WorkSummary / WorkDetail / AnnictWork 等が満たす。 */
export interface MovieDateInput {
  releasedOn?: string | null;
  releasedOnAbout?: string | null;
  seasonYear: number | null;
  seasonName: Season | null;
}

/** シーズン名→公開日近似の月（公開日が無い映画のフォールバック, JST） */
const SEASON_MONTH: Record<Season, number> = { winter: 1, spring: 4, summer: 7, autumn: 10 };

/**
 * 映画の公開日（YYYY-MM-DD）を決める。released_on を優先し、無ければ season から近似。
 * @returns YYYY-MM-DD。判定材料が無ければ null。
 */
export function movieReleaseDate(w: MovieDateInput): string | null {
  if (w.releasedOn && /^\d{4}-\d{2}-\d{2}$/.test(w.releasedOn)) return w.releasedOn;
  if (w.seasonYear && w.seasonName) {
    const m = SEASON_MONTH[w.seasonName] ?? 1;
    return `${w.seasonYear}-${String(m).padStart(2, "0")}-01`;
  }
  return null;
}

/** 公開日が正確（released_on 由来）か、season からの近似か。 */
export function hasExactReleaseDate(w: MovieDateInput): boolean {
  return Boolean(w.releasedOn && /^\d{4}-\d{2}-\d{2}$/.test(w.releasedOn));
}

export type ScreeningKind = "scheduled" | "soon" | "now" | "ended";

/** 「近日上映開始」とみなす公開前の日数。 */
const SOON_DAYS = 30;
/** 公開後この日数までは「上映中」とみなす（劇場公開の概ねの上映期間）。 */
const SHOWING_DAYS = 60;
const DAY_MS = 86400000;

/**
 * 映画の上映ステータスを返す。
 *  - scheduled: 上映予定（公開まで30日超）
 *  - soon:      近日上映開始（公開30日前〜公開日）
 *  - now:       上映中（公開日〜公開60日後）
 *  - ended:     上映終了（公開60日超）
 */
export function movieScreeningStatus(
  w: MovieDateInput,
  now: Date = new Date(),
): { kind: ScreeningKind; label: string; date: string | null } {
  const date = movieReleaseDate(w);
  if (!date) return { kind: "scheduled", label: "上映予定", date: null };
  const t = new Date(`${date}T00:00:00+09:00`).getTime();
  const n = now.getTime();
  if (n < t - SOON_DAYS * DAY_MS) return { kind: "scheduled", label: "上映予定", date };
  if (n < t) return { kind: "soon", label: "近日上映開始", date };
  if (n < t + SHOWING_DAYS * DAY_MS) return { kind: "now", label: "上映中", date };
  return { kind: "ended", label: "上映終了", date };
}

/** 公開日の表示用文字列。正確な日付は「2026/5/1」、近似は releasedOnAbout かシーズン表記。 */
export function formatReleaseDate(w: MovieDateInput): string | null {
  if (hasExactReleaseDate(w)) {
    const [y, m, d] = w.releasedOn!.split("-");
    return `${y}/${Number(m)}/${Number(d)}`;
  }
  if (w.releasedOnAbout) return w.releasedOnAbout;
  const date = movieReleaseDate(w);
  if (!date) return null;
  const [y, m] = date.split("-");
  return `${y}年${Number(m)}月ごろ`;
}
