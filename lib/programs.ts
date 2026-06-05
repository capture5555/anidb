/**
 * 放送回(program)に関する共通ユーティリティ。
 */

// 代表局として優先したいチャンネル（上にあるほど優先）。
// 全国系列ネットの作品で、ローカル局ではなくキー局を代表に選ぶために使う。
const CHANNEL_PRIORITY = [
  "TOKYO MX",
  "テレビ東京",
  "テレビ朝日",
  "日本テレビ",
  "TBS",
  "フジテレビ",
  "NHK",
  "BS11",
  "AT-X",
  "BSフジ",
  "BS日テレ",
  "BS朝日",
  "BSテレ東",
  "ABEMA",
  "dアニメストア",
];

function channelRank(name: string | null): number {
  if (!name) return 999;
  const i = CHANNEL_PRIORITY.findIndex((p) => name.includes(p));
  return i < 0 ? 900 : i;
}

/**
 * 同じ話数で複数の放送（系列局のネット放送など）がある場合、代表を1件だけ残す。
 * - 話数(count)があればそれで集約。無い場合でも系列局の同時ネットは放送時刻が完全一致するため
 *   startAt で集約すれば重複（同じ回が複数局ぶん並ぶ）を防げる。
 * - 代表は「キー局優先 → 同順位なら放送が早い方」で選ぶ。
 * カレンダー登録の重複防止・一覧表示の整理に使う。
 */
export function pickOnePerEpisode<
  T extends {
    id: string;
    count: number | null;
    episodeId: string | null;
    startAt: string;
    channelName?: string | null;
  },
>(programs: T[]): T[] {
  const rep = new Map<string, T>();
  for (const p of programs) {
    const key = p.count != null ? `c${p.count}` : `t${p.startAt}`;
    const cur = rep.get(key);
    if (!cur || isBetterRep(p, cur)) rep.set(key, p);
  }
  return [...rep.values()].sort((a, b) => a.startAt.localeCompare(b.startAt));
}

function isBetterRep(a: { startAt: string; channelName?: string | null }, b: { startAt: string; channelName?: string | null }): boolean {
  const ra = channelRank(a.channelName ?? null);
  const rb = channelRank(b.channelName ?? null);
  if (ra !== rb) return ra < rb; // キー局を優先
  return a.startAt < b.startAt; // 同順位なら早い放送
}
