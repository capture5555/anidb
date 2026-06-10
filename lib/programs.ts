/**
 * 放送回(program)に関する共通ユーティリティ。
 */
import { channelRank, DEFAULT_REGION, type Region } from "./regions.ts";

/**
 * 同じ話数で複数の放送（系列局のネット放送など）がある場合、代表を1件だけ残す。
 * - 話数(count)があればそれで集約。無い場合でも系列局の同時ネットは放送時刻が完全一致するため
 *   startAt で集約すれば重複（同じ回が複数局ぶん並ぶ）を防げる。
 * - 代表は「指定地域で優先される局 → 同順位なら放送が早い方」で選ぶ。
 *   region を省略すると関東（キー局優先）。
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
>(programs: T[], region: Region = DEFAULT_REGION): T[] {
  const rep = new Map<string, T>();
  for (const p of programs) {
    const key = p.count != null ? `c${p.count}` : `t${p.startAt}`;
    const cur = rep.get(key);
    if (!cur || isBetterRep(p, cur, region)) rep.set(key, p);
  }
  return [...rep.values()].sort((a, b) => a.startAt.localeCompare(b.startAt));
}

function isBetterRep(
  a: { startAt: string; channelName?: string | null },
  b: { startAt: string; channelName?: string | null },
  region: Region,
): boolean {
  const ra = channelRank(a.channelName ?? null, region);
  const rb = channelRank(b.channelName ?? null, region);
  if (ra !== rb) return ra < rb; // 地域の優先局を優先
  return a.startAt < b.startAt; // 同順位なら早い放送
}
