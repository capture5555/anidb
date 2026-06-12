// ============================================================
//  非作品（PV/CM/プロモ/音楽/Piccoma 等）の判定
//  ------------------------------------------------------------
//  Annict 由来データには本編アニメ以外（プロモーション映像・CM・
//  ミュージックビデオ・ピッコマ等の販促エントリ）が混在する。
//  専用フラグが無いため「タイトルの正規表現 + media 種別」で判定し、
//  一覧・番組表・直近放送などの閲覧面からサイト全体で除外する。
//
//  判定方針（ユーザー決定）:
//   - tv / movie / ova の本編は常に作品として扱う（誤除外しない）。
//   - media が other / web / 不明 で、かつタイトルが下記パターンに
//     合致するものだけを「非作品」として除外する。
// ============================================================

import type { Media } from "./types.ts";

/** 非作品を示すタイトルパターン（大文字小文字無視）。 */
const NON_WORK_TITLE_RE =
  /(?:\bPV\b|プロモーション(?:ビデオ|映像)?|\bCM(?:集)?\b|特報|予告(?:編|映像|PV)?|ティザー|teaser|trailer|\bMV\b|ミュージック(?:ビデオ|クリップ|・?ビデオ)|music\s*video|ノンクレジット|ピッコマ|piccoma)/i;

/** 本編として常に残す media 種別。 */
const CORE_MEDIA: ReadonlySet<Media> = new Set<Media>(["tv", "movie", "ova"]);

/**
 * 与えられた作品が「非作品」かどうかを返す。
 * @param work title と media を持つ最小オブジェクト
 */
export function isNonWork(work: { title: string; media: Media | null }): boolean {
  // tv / movie / ova の本編は除外対象にしない
  if (work.media && CORE_MEDIA.has(work.media)) return false;
  // それ以外（other / web / null）でタイトルが販促パターンに合致するもの
  return NON_WORK_TITLE_RE.test(work.title ?? "");
}

/**
 * 作品リストから非作品を取り除く。
 * @param works title と media を持つオブジェクトの配列
 */
export function excludeNonWorks<T extends { title: string; media: Media | null }>(
  works: T[],
): T[] {
  return works.filter((w) => !isNonWork(w));
}

/**
 * PostgREST(Supabase) クエリ用の非作品除外フィルタ文字列。
 * `isNonWork` のロジックを SQL 側で近似する（ページング/件数を正確に保つため）。
 *
 *   保持条件 = 本編media(tv/movie/ova) である OR どの販促語にも合致しない
 *
 * `query.or(NON_WORK_OR_FILTER)` の形で使う。
 */
const NON_WORK_ILIKE_TERMS = [
  "PV",
  "プロモーション",
  "CM",
  "特報",
  "予告",
  "ティザー",
  "teaser",
  "trailer",
  "MV",
  "ミュージックビデオ",
  "ミュージッククリップ",
  "music video",
  "ノンクレジット",
  "ピッコマ",
  "piccoma",
];

export const NON_WORK_OR_FILTER = [
  "media.in.(tv,movie,ova)",
  `and(${NON_WORK_ILIKE_TERMS.map((t) => `title.not.ilike.*${t}*`).join(",")})`,
].join(",");
