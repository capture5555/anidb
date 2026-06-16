// ============================================================
//  非作品・対象外作品の判定
//  ------------------------------------------------------------
//  Annict 由来データには本編TVアニメ・劇場アニメ以外も多く含まれる
//  （PV/CM/プロモ映像・ミュージックビデオ・ピッコマ等のwebtoon販促・
//   ゲームの宣伝アニメ・ONA/ショート・OVA/単発 など）。
//  専用フラグが無いため、次の3軸でサイト全体（一覧・番組表・直近放送）
//  から除外する。
//
//  判定方針（ユーザー決定）:
//   1. media 種別で「TV・映画のみ」に絞る（ova/web/other を除外）。
//      media 不明(null) は TV 放送枠(programs)があれば残す。
//   2. タイトルの販促パターン（PV/CM/予告/MV/ピッコマ 等）を除外。
//   3. 個別デニーリスト（ゲーム宣伝アニメ等、媒体に関わらず除外）。
// ============================================================

import type { Media } from "./types.ts";

/** 非作品を示すタイトルパターン（大文字小文字無視）。 */
const NON_WORK_TITLE_RE =
  /(?:\bPV\b|プロモーション(?:ビデオ|映像)?|\bCM(?:集)?\b|特報|予告(?:編|映像|PV)?|ティザー|teaser|trailer|\bMV\b|ミュージック(?:ビデオ|クリップ|・?ビデオ)|music\s*video|ノンクレジット|ショートアニメ|ピッコマ|piccoma)/i;

/**
 * 個別デニーリスト（媒体に関わらず除外）。
 * ゲームの宣伝アニメなど、media では拾えない既知の対象外作品をここに追加する。
 */
const DENYLIST_TITLE_RE = /(?:Neverness\s*to\s*Everness|\bNTE\b)/i;

/** 一覧に出す本編 media（劇場・TV）。 */
const LIST_CORE_MEDIA: ReadonlySet<Media> = new Set<Media>(["tv", "movie"]);

/** 販促パターン判定で「本編」として保護する media。 */
const PROTECTED_MEDIA: ReadonlySet<Media> = new Set<Media>(["tv", "movie", "ova"]);

/**
 * media 種別が一覧表示に適格か。
 *  - tv / movie         : 常に表示
 *  - null               : TV 放送枠(programs)があれば表示
 *  - ova / web / other  : 非表示
 * @param hasTvPrograms 当該作品に放送枠（programs）が存在するか
 */
export function mediaAllowedInList(media: Media | null, hasTvPrograms: boolean): boolean {
  if (media && LIST_CORE_MEDIA.has(media)) return true;
  if (media == null) return hasTvPrograms;
  return false;
}

/**
 * 番組表など「放送枠ベース」の面で除外すべき media か（ova/web/other）。
 * null は放送枠があるからこそ番組表に出るので許可する。
 */
export function isExcludedListMedia(media: Media | null): boolean {
  return media != null && !LIST_CORE_MEDIA.has(media);
}

/**
 * 与えられた作品が「非作品」（タイトル販促パターン or デニーリスト）かどうか。
 * media 絞り込みとは別軸。番組表・seed など個別判定で使う。
 * @param work title と media を持つ最小オブジェクト
 */
export function isNonWork(work: { title: string; media: Media | null }): boolean {
  const title = work.title ?? "";
  if (DENYLIST_TITLE_RE.test(title)) return true; // デニーリストは媒体に関わらず除外
  // tv / movie / ova の本編は販促パターン誤検知の対象にしない
  if (work.media && PROTECTED_MEDIA.has(work.media)) return false;
  return NON_WORK_TITLE_RE.test(title);
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

// ------------------------------------------------------------
//  PostgREST(Supabase) クエリ用フィルタ（件数・ページングを正確に保つため
//  可能な限り DB 側で除外する）
// ------------------------------------------------------------

/**
 * 非作品（販促パターン）の DB 側除外フィルタ。
 *   保持条件 = 本編media(tv/movie/ova) である OR どの販促語にも合致しない
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
  "ショートアニメ",
  "ピッコマ",
  "piccoma",
];

export const NON_WORK_OR_FILTER = [
  "media.in.(tv,movie,ova)",
  `and(${NON_WORK_ILIKE_TERMS.map((t) => `title.not.ilike.*${t}*`).join(",")})`,
].join(",");

/**
 * media を「TV・映画・不明」に絞る DB フィルタ（ova/web/other を除外）。
 * null は残し、放送枠の有無は取得後に `mediaAllowedInList` で最終判定する。
 * `query.or(LIST_MEDIA_OR_FILTER)` の形で使う。
 */
export const LIST_MEDIA_OR_FILTER = "media.in.(tv,movie),media.is.null";

/**
 * デニーリストの DB 側除外用 ilike 語句（媒体に関わらず除外）。
 * provider 側で `query.not("title","ilike",`%term%`)` を連結して使う。
 */
export const DENYLIST_ILIKE_TERMS = ["Neverness to Everness"];
