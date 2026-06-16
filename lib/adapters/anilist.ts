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
        idMal
        title { native romaji english }
        seasonYear
        averageScore
        popularity
        coverImage { extraLarge large }
        description(asHtml: false)
        genres
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
  idMal: number | null;
  title: { native: string | null; romaji: string | null; english: string | null };
  seasonYear: number | null;
  averageScore: number | null; // 0-100
  popularity: number | null; // 登録者数
  coverImage: { extraLarge: string | null; large: string | null };
  description: string | null; // プレーンテキストあらすじ
  genres: string[] | null;
}

export interface AniListInfo {
  posterUrl: string | null;
  score: number | null; // 0-100（海外平均）
  popularity: number | null; // 海外登録者数
  malId: number | null;
  description: string | null; // HTMLタグ除去済みあらすじ
  genres: string[]; // ジャンル名リスト
}

const titlesOf = (m: AniMedia) =>
  [m.title.native, m.title.romaji, m.title.english].filter(Boolean) as string[];

/** 続編・サブタイトルの接尾辞を除いた「コアタイトル」を作る（検索ヒット率向上用）
 *  ※「Re:ゼロ」等の作品名内コロンを切らないよう、コロンでは分割しない。 */
function coreTitle(title: string): string {
  return title
    .replace(/\s*(?:1st|2nd|3rd|4th|5th|6th|7th|\d+(?:st|nd|rd|th))\s*season.*$/i, "")
    .replace(/\s*season\s*\d+.*$/i, "")
    .replace(/\s*第[0-9０-９]+期.*$/, "")
    .replace(/\s*(?:Part|パート)\s*[0-9０-９]+.*$/i, "")
    .replace(/\s+(?:II|III|IV|V|VI|VII)\b.*$/i, "")
    .replace(/[ 　].*$/, "") // 最初の空白以降（版数/サブタイトル）を落とす。コロンは保持。
    .trim();
}

/** 候補タイトルが検索語と「十分強く」一致するか。短い断片での誤マッチを防ぐ。 */
function strongMatch(candidate: string, nq: string, nt: string): boolean {
  const ntt = norm(candidate);
  if (!ntt) return false;
  if (ntt === nt || ntt === nq) return true; // 完全一致
  const MIN = 5; // 含有判定は5文字以上の側でのみ許可
  if (nq.length >= MIN && ntt.includes(nq)) return true;
  if (ntt.length >= MIN && nq.includes(ntt)) return true;
  return false;
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
/** タイトル（＋年）から最も確からしいAniList作品を1件返す。誤マッチ防止の厳格判定つき。 */
async function matchMedia(title: string, year?: number | null): Promise<AniMedia | null> {
  const core = coreTitle(title);
  const queries = core && norm(core) !== norm(title) ? [title, core] : [title];
  const nt = norm(title);
  for (const q of queries) {
    const media = await searchMedia(q);
    if (media.length === 0) continue;
    const nq = norm(q);
    const matches = media.filter((m) => titlesOf(m).some((t) => strongMatch(t, nq, nt)));
    if (matches.length === 0) continue;
    const exact = matches.find((m) => titlesOf(m).some((t) => norm(t) === nt || norm(t) === nq));
    const byYear = year ? matches.find((m) => m.seasonYear === year) : undefined;
    return exact ?? byYear ?? matches[0];
  }
  return null;
}

/** AniList description はプレーンテキスト想定だが念のためHTMLタグを除去し、余分な空白を正規化する */
function stripHtml(text: string | null | undefined): string | null {
  if (!text) return null;
  return text
    .replace(/<[^>]*>/g, " ") // タグを空白に置換
    .replace(/&[a-z]+;/gi, (e) => {
      const m: Record<string, string> = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&apos;": "'", "&nbsp;": " " };
      return m[e.toLowerCase()] ?? " ";
    })
    .replace(/\s+/g, " ")
    .trim() || null;
}

export async function fetchPosterUrl(title: string, year?: number | null): Promise<string | null> {
  const m = await matchMedia(title, year);
  return m?.coverImage.extraLarge ?? m?.coverImage.large ?? null;
}

/** タイトル（＋年）から AniList のスコア・登録者数・MAL ID・あらすじ・ジャンルを取得 */
export async function fetchAniListInfo(title: string, year?: number | null): Promise<AniListInfo> {
  const m = await matchMedia(title, year);
  return {
    posterUrl: m?.coverImage.extraLarge ?? m?.coverImage.large ?? null,
    score: m?.averageScore ?? null,
    popularity: m?.popularity ?? null,
    malId: m?.idMal ?? null,
    description: stripHtml(m?.description),
    genres: m?.genres ?? [],
  };
}
