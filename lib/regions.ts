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
  bs: "BS11・ABEMA・dアニメストア など全国系を優先",
};

// 地上波の全国放送（NHK）。地上波なので全地域で「放送局」として番組表に出す。
export const NHK_TERRESTRIAL = ["NHK総合", "NHK Eテレ", "NHK"];

// BS/衛星。BS・配信地域でのみ番組表・この後・カレンダーに出す（地上波地域には出さない）。
export const BS_CHANNELS = [
  "BS11",
  "BSフジ",
  "BS日テレ",
  "BS朝日",
  "BS-TBS",
  "BSテレ東",
  "BS12",
  "BS松竹東急",
  "WOWOW",
];

// 番組表・「この後の放送」・カレンダーには出さないチャンネル（ネット配信＋AT-X(CS有料)）。
// 代表チャンネルのランク付け・将来用途のため名前は保持する。
export const STREAMING = [
  "AT-X",
  "ABEMA",
  "dアニメストア",
  "Amazon",
  "Netflix",
  "Disney",
  "Hulu",
  "U-NEXT",
  "FOD",
  "DMM",
  "Lemino",
  "バンダイチャンネル",
  "ニコニコ",
];

// 各地域で優先する地上波局（上にあるほど優先）。
export const REGION_LOCALS: Record<Region, string[]> = {
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

/**
 * その地域で「番組表・この後の放送・カレンダー」に出してよいチャンネル列（優先度順）。
 * - 地上波地域(関東/関西/中部): 地域の地上波ローカル ＋ NHK(地上波)。BS・配信は出さない。
 * - BS・配信: NHK(地上波) ＋ BS。
 */
export function displayList(region: Region): string[] {
  if (region === "bs") return [...NHK_TERRESTRIAL, ...BS_CHANNELS];
  return [...REGION_LOCALS[region], ...NHK_TERRESTRIAL];
}

/**
 * チャンネル名の、指定地域における優先度（小さいほど優先）。
 * 表示対象 → 表示対象外の放送波 → 配信 の順。一致しなくても必ず数値を返す（ソート用）。
 */
export function channelRank(name: string | null | undefined, region: Region): number {
  if (!name) return 9999;
  const i = displayList(region).findIndex((p) => name.includes(p));
  if (i >= 0) return i;
  if (isStreamingChannel(name)) return 9500; // 配信・AT-X は最後尾
  return 9000; // 表示対象外の放送波（地域外ローカル・地上波地域でのBS など）
}

/**
 * 「この後の放送」「番組表」「カレンダー」に表示してよいチャンネルか。
 * = その地域で実際に視聴できる放送局のみ（地上波地域はBS・配信を含めない）。
 */
export function isDisplayChannel(name: string | null | undefined, region: Region): boolean {
  if (!name) return false;
  return displayList(region).some((p) => name.includes(p));
}

/**
 * ネット配信（およびユーザー方針でカレンダーに出さない AT-X）かどうか。
 * カレンダー(ICS)は「テレビ放送のみ」にするため、これが true のチャンネルは予定にしない。
 */
export function isStreamingChannel(name: string | null | undefined): boolean {
  if (!name) return false;
  return STREAMING.some((s) => name.includes(s));
}

export function parseRegion(value: string | null | undefined): Region {
  if (value && (REGION_KEYS as string[]).includes(value)) return value as Region;
  return DEFAULT_REGION;
}

/** Cookie名（TOPなどログイン不要画面の地域記憶用） */
export const REGION_COOKIE = "pref_region";
