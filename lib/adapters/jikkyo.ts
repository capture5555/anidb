/**
 * ニコニコ実況 過去ログAPI（jikkyo.tsukumijima.net）アダプタ。
 *   GET https://jikkyo.tsukumijima.net/api/kakolog/{jkID}?starttime={unix}&endtime={unix}&format=json
 * 個人運営の公開APIのため、礼儀として呼び出し間隔を空け（呼び出し側で1s）、
 * リトライは控えめにする（lib/adapters/mal.ts のパターンを踏襲）。
 */

const BASE = "https://jikkyo.tsukumijima.net/api/kakolog";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface JikkyoComment {
  /** 投稿時刻（unix秒） */
  date: number;
  content: string;
}

/** 指定チャンネル・時間帯のコメントを取得。ログが無い場合は空配列。 */
export async function fetchKakolog(
  jkId: string,
  startUnix: number,
  endUnix: number,
): Promise<JikkyoComment[]> {
  const url = `${BASE}/${jkId}?starttime=${startUnix}&endtime=${endUnix}&format=json`;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const res = await fetch(url, { headers: { Accept: "application/json" } });
      if (res.status === 429 || res.status >= 500) {
        await sleep(3000);
        continue;
      }
      if (!res.ok) return [];
      const json: any = await res.json().catch(() => null);
      if (!json) return [];
      // ログが存在しない期間は {"error": "..."} が返る → コメント無し扱い
      if (json.error) return [];
      const packet: any[] = json.packet ?? [];
      const comments: JikkyoComment[] = [];
      for (const item of packet) {
        const chat = item?.chat;
        if (!chat?.content) continue;
        const date = Number(chat.date);
        if (!Number.isFinite(date)) continue;
        comments.push({ date, content: String(chat.content) });
      }
      return comments;
    } catch {
      await sleep(2000);
    }
  }
  throw new Error(`kakolog fetch failed: ${jkId} ${startUnix}-${endUnix}`);
}

/** コメントを放送開始からの分単位に集計する */
export function bucketByMinute(
  comments: JikkyoComment[],
  startUnix: number,
): Map<number, number> {
  const buckets = new Map<number, number>();
  for (const c of comments) {
    const minute = Math.floor((c.date - startUnix) / 60);
    if (minute < 0) continue;
    buckets.set(minute, (buckets.get(minute) ?? 0) + 1);
  }
  return buckets;
}
