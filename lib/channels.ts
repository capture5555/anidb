/**
 * グローバルな放送局選択（おすすめ順の複数選択）。
 *
 * Stage 1 では、地域(関東/関西/中部/BS)の代わりに「視聴できる放送局」を明示的に選ぶ。
 * 選択は 番組表 / この後の放送 / カレンダーフィードの既定 を駆動する。
 * 地域(regions.ts)は削除せず、未設定ユーザーへ既定の放送局セットを与える「種」として残す。
 *
 * チャンネル名は DB 上で揺れる（"NHK総合・東京" など）ため、選択値は正規化済みの短い名称とし、
 * 突き合わせは isDisplayChannel と同じく「部分一致(substring)」で行う。
 */
import {
  NHK_TERRESTRIAL,
  BS_CHANNELS,
  REGION_LOCALS,
  displayList,
  isStreamingChannel,
  DEFAULT_REGION,
  type Region,
} from "./regions.ts";

/**
 * おすすめ順の正規化済みチャンネル名一覧。
 * NHK総合/Eテレ → 関東キー局/独立局 → 関西ローカル → 中部ローカル → BS の順。
 * regions.ts の配列を連結し、重複を除いて順序を保つ。
 */
export const RECOMMENDED_CHANNELS: string[] = dedupe([
  "NHK総合",
  "NHK Eテレ",
  ...REGION_LOCALS.kanto,
  ...REGION_LOCALS.kansai,
  ...REGION_LOCALS.chubu,
  ...BS_CHANNELS,
]);

function dedupe(list: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const name of list) {
    if (seen.has(name)) continue;
    seen.add(name);
    out.push(name);
  }
  return out;
}

/** 未設定(空配列)時の既定挙動で使う「全放送波(配信以外)」フォールバック。 */
function isBroadcast(name: string | null | undefined): boolean {
  return !!name && !isStreamingChannel(name);
}

/**
 * チャンネル名が選択集合のいずれかに一致するか（部分一致）。
 * selected が空のときは「配信以外の全放送波」を真とする（番組表が空にならない保険）。
 */
export function channelMatches(
  name: string | null | undefined,
  selected: string[],
): boolean {
  if (!name) return false;
  if (selected.length === 0) return isBroadcast(name);
  return selected.some((p) => name.includes(p));
}

/**
 * チャンネル名の優先度（小さいほど優先）。
 * selected 内の位置 → 見つからない放送波(9000) → 配信(9500)。一致しなくても必ず数値を返す。
 */
export function channelRankBy(
  name: string | null | undefined,
  selected: string[],
): number {
  if (!name) return 9999;
  const i = selected.findIndex((p) => name.includes(p));
  if (i >= 0) return i;
  if (isStreamingChannel(name)) return 9500;
  return 9000;
}

/**
 * (レガシー)地域から既定の放送局セットを得る。
 * preferred_channels 未設定のユーザーでも、地域 Cookie 由来で妥当な既定が出るようにする。
 */
export function seedChannelsFromRegion(region: Region = DEFAULT_REGION): string[] {
  return displayList(region);
}

/** Cookie名（ログイン不要画面のチャンネル記憶用・カンマ区切り） */
export const CHANNELS_COOKIE = "pref_channels";

/** カンマ区切り Cookie 値を正規化済みチャンネル名配列にパースする。 */
export function parseChannelsCookie(value: string | null | undefined): string[] {
  if (!value) return [];
  return dedupe(
    value
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0),
  );
}

/** 配列をカンマ区切り Cookie 値へ直列化する。 */
export function serializeChannelsCookie(channels: string[]): string {
  return dedupe(channels).join(",");
}
