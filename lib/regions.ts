/**
 * 放送地域（関東/関西/中部・東海/BS・配信）ごとの代表チャンネル選択。
 *
 * DBには「地域」フィールドが無いため、チャンネル名から地域を判定する。
 * カレンダーのICSフィード・TOPの「この後の放送」・作品ページの放送情報で、
 * 「住んでいる地域で実際に放送される局」を代表に選ぶために使う。
 */

export type Region = "kanto" | "kansai" | "chubu" | "bs";

export const DEFAULT_REGION: Region = "kanto";

export const REGION_LABELS: Record<Region, string> = {
  kanto: "関東",
  kansai: "関西",
  chubu: "中部・東海",
  bs: "BS・配信",
};

export const REGION_KEYS: Region[] = ["kanto", "kansai", "chubu", "bs"];

export const REGION_NOTES: Record<Region, string> = {
  kanto: "TOKYO MX・テレ東・日テレ・テレ朝・TBS・フジ・NHK ほか",
  kansai: "MBS・ABC・カンテレ・読売テレビ・サンテレビ・KBS京都・テレビ大阪 ほか",
  chubu: "中京テレビ・東海テレビ・メ〜テレ・CBC・テレビ愛知 ほか",
  bs: "BS11・AT-X・ABEMA・dアニメストア など全国系を優先",
};

// 全地域共通で、地域局の後ろに付ける全国系（BS/CS/配信/NHK）の優先順。
const NATIONWIDE_TAIL = [
  "NHK総合",
  "NHK Eテレ",
  "NHK",
  "BS11",
  "AT-X",
  "BSフジ",
  "BS日テレ",
  "BS朝日",
  "BSテレ東",
  "BS松竹東急",
  "WOWOW",
  "ABEMA",
  "dアニメストア",
  "Amazon",
  "Netflix",
];

// 各地域で優先する地上波局（上にあるほど優先）。
const REGION_LOCALS: Record<Region, string[]> = {
  kanto: [
    "TOKYO MX",
    "テレビ東京",
    "日本テレビ",
    "テレビ朝日",
    "TBS",
    "フジテレビ",
    "tvk",
    "テレビ神奈川",
    "テレ玉",
    "チバテレ",
    "とちぎ",
    "群馬テレビ",
  ],
  kansai: [
    "MBS",
    "毎日放送",
    "ABCテレビ",
    "朝日放送",
    "関西テレビ",
    "カンテレ",
    "読売テレビ",
    "ytv",
    "サンテレビ",
    "KBS京都",
    "テレビ大阪",
  ],
  chubu: [
    "中京テレビ",
    "東海テレビ",
    "メ〜テレ",
    "名古屋テレビ",
    "CBC",
    "テレビ愛知",
  ],
  // BS優先地域は地上波局を持たない（全国系を最優先）
  bs: [],
};

/** 地域ごとの優先順リスト（地域局 → 全国系）。 */
function priorityFor(region: Region): string[] {
  return [...REGION_LOCALS[region], ...NATIONWIDE_TAIL];
}

/**
 * チャンネル名の、指定地域における優先度（小さいほど優先）。
 * 一致しないチャンネルでも必ず数値を返す（＝候補から落とさない）。
 */
export function channelRank(name: string | null | undefined, region: Region): number {
  if (!name) return 9999;
  const list = priorityFor(region);
  const i = list.findIndex((p) => name.includes(p));
  if (i >= 0) return i;
  // リストに無い地方局など。全国系より後ろ・名前未定より前。
  return 9000;
}

export function parseRegion(value: string | null | undefined): Region {
  if (value && (REGION_KEYS as string[]).includes(value)) return value as Region;
  return DEFAULT_REGION;
}

/** Cookie名（TOPなどログイン不要画面の地域記憶用） */
export const REGION_COOKIE = "pref_region";
