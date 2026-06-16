/**
 * MyAnimeList データ取得（Jikan API・認証不要）。
 * タイトルのあいまい検索は誤マッチしやすいため、AniListが返す idMal（MAL ID）で
 * 直接引く（確実）。
 */

const BASE = "https://api.jikan.moe/v4";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface MalInfo {
  score: number | null; // 0-10
  scoredBy: number | null; // 評価人数
  members: number | null; // 登録者数
  rank: number | null;
}

/** MAL ID から評価情報を取得 */
export async function fetchMalById(malId: number): Promise<MalInfo | null> {
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const res = await fetch(`${BASE}/anime/${malId}`, {
        headers: { Accept: "application/json" },
      });
      if (res.status === 429) {
        await sleep(2000);
        continue;
      }
      if (res.status === 404) return null;
      if (!res.ok) return null;
      const json = await res.json().catch(() => null);
      const d = json?.data;
      if (!d) return null;
      return {
        score: d.score ?? null,
        scoredBy: d.scored_by ?? null,
        members: d.members ?? null,
        rank: d.rank ?? null,
      };
    } catch {
      await sleep(1500);
    }
  }
  return null;
}
