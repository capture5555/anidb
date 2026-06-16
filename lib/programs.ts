/**
 * 放送回(program)に関する共通ユーティリティ。
 */
import { channelRankBy } from "./channels.ts";

/**
 * 同じ話数で複数の放送（系列局のネット放送など）がある場合、代表を1件だけ残す。
 * - 話数(count)があればそれで集約。無い場合でも系列局の同時ネットは放送時刻が完全一致するため
 *   startAt で集約すれば重複（同じ回が複数局ぶん並ぶ）を防げる。
 * - 代表は「選択された放送局の優先順 → 同順位なら放送が早い方」で選ぶ。
 *   channels を省略（空配列）すると、配信以外の全放送波の中から放送が早い方を代表にする。
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
>(programs: T[], channels: string[] = []): T[] {
  const rep = new Map<string, T>();
  for (const p of programs) {
    const key = p.count != null ? `c${p.count}` : `t${p.startAt}`;
    const cur = rep.get(key);
    if (!cur || isBetterRep(p, cur, channels)) rep.set(key, p);
  }
  return [...rep.values()].sort((a, b) => a.startAt.localeCompare(b.startAt));
}

function isBetterRep(
  a: { startAt: string; channelName?: string | null },
  b: { startAt: string; channelName?: string | null },
  channels: string[],
): boolean {
  const ra = channelRankBy(a.channelName ?? null, channels);
  const rb = channelRankBy(b.channelName ?? null, channels);
  if (ra !== rb) return ra < rb; // 選択局の優先順を優先
  return a.startAt < b.startAt; // 同順位なら早い放送
}
