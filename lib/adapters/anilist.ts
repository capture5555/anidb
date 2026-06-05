/**
 * AniList アダプタ（認証不要）。
 * 縦長のポスター画像（coverImage）を取得するために使う。
 * Annictの画像は横長が多いため、サムネイル用にAniListの縦ポスターで補完する。
 */

const ENDPOINT = "https://graphql.anilist.co";

const QUERY = /* GraphQL */ `
  query ($search: String) {
    Page(perPage: 8) {
      media(search: $search, type: ANIME, sort: SEARCH_MATCH) {
        title { native romaji english }
        seasonYear
        coverImage { extraLarge large }
      }
    }
  }
`;

function norm(s: string): string {
  return s
    .replace(/\s+/g, "")
    .replace(/[!！?？、。・,.:：;；'"’”\-―ー~〜]/g, "")
    .normalize("NFKC")
    .toLowerCase();
}

interface AniMedia {
  title: { native: string | null; romaji: string | null; english: string | null };
  seasonYear: number | null;
  coverImage: { extraLarge: string | null; large: string | null };
}

const titlesOf = (m: AniMedia) =>
  [m.title.native, m.title.romaji, m.title.english].filter(Boolean) as string[];

/** 続編・サブタイトルの接尾辞を除いた「コアタイトル」を作る（検索ヒット率向上用） */
function coreTitle(title: string): string {
  return title
    .replace(/\s*(?:1st|2nd|3rd|4th|5th|\d+(?:st|nd|rd|th))\s*season.*$/i, "")
    .replace(/\s*season\s*\d+.*$/i, "")
    .replace(/\s*第[0-9０-９]+期.*$/, "")
    .replace(/\s+(?:II|III|IV)\b.*$/i, "")
    .replace(/[ 　:：].*$/, "") // 最初の空白/コロン以降（サブタイトル）を落とす
    .replace(/\s*[0-9０-９]+\s*$/, "") // 末尾の数字（2期の「2」等）
    .trim();
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function searchMedia(search: string): Promise<AniMedia[]> {
  // AniListはレート制限が厳しめ。429のときは Retry-After に従って待機し、数回リトライする。
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const res = await fetch(ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ query: QUERY, variables: { search } }),
      });
      if (res.status === 429) {
        const retryAfter = Number(res.headers.get("retry-after")) || 5;
        await sleep((retryAfter + 1) * 1000);
        continue;
      }
      if (!res.ok) return [];
      const json = await res.json().catch(() => null);
      return json?.data?.Page?.media ?? [];
    } catch {
      await sleep(1500);
    }
  }
  return [];
}

/**
 * タイトル（＋放送年）から縦ポスター画像URLを返す。
 * フルタイトルで検索 → 当たらなければ続編接尾辞を除いたコアタイトルで再検索。
 * 誤マッチを避けるため、正規化一致 or 部分一致（検索語/作品名のどちらか方向）した場合のみ採用。
 */
export async function fetchPosterUrl(title: string, year?: number | null): Promise<string | null> {
  const core = coreTitle(title);
  const queries = core && norm(core) !== norm(title) ? [title, core] : [title];

  for (const q of queries) {
    const media = await searchMedia(q);
    if (media.length === 0) continue;
    const nq = norm(q);
    const nt = norm(title);

    // 1) いずれかの表記が完全一致
    let hit = media.find((m) => titlesOf(m).some((t) => norm(t) === nt || norm(t) === nq));
    // 2) 年一致 ＋ 部分一致
    if (!hit && year) {
      hit = media.find(
        (m) =>
          m.seasonYear === year &&
          titlesOf(m).some((t) => {
            const ntt = norm(t);
            return ntt.includes(nq) || nq.includes(ntt);
          }),
      );
    }
    // 3) 部分一致（検索語と作品名のどちらか方向）
    if (!hit) {
      hit = media.find((m) =>
        titlesOf(m).some((t) => {
          const ntt = norm(t);
          return ntt.includes(nq) || nq.includes(ntt);
        }),
      );
    }
    const url = hit?.coverImage.extraLarge ?? hit?.coverImage.large ?? null;
    if (url) return url;
  }
  return null;
}
