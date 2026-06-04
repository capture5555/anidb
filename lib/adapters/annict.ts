/**
 * Annict GraphQL API アダプタ。
 * 作品メタ（タイトル/あらすじ/画像/シーズン/エピソード/キャスト/スタッフ/放送予定のscPid）を取得する。
 * docs/05 参照。ANNICT_TOKEN が必要。
 *
 * ※ Annictの放送予定ページは廃止されており放送時刻の精度は低いため、
 *   正確な時刻は syoboi.ts 側を正とする。ここでは scPid（しょぼいPID）など紐付けに使える情報も拾う。
 */

const ENDPOINT = "https://api.annict.com/graphql";

export interface AnnictWork {
  annictId: number;
  title: string;
  titleKana: string | null;
  titleEn: string | null;
  seasonYear: number | null;
  seasonName: string | null; // SPRING等
  officialSiteUrl: string | null;
  synopsis: string | null;
  imageUrl: string | null;
  media: string | null;
  episodes: { annictId: number; number: number | null; numberText: string | null; title: string | null }[];
  casts: { name: string; character: string }[];
  staffs: { roleText: string; name: string }[];
  /** Annictが把握している放送予定（紐付け用。scPid=しょぼいPID） */
  programs: { scPid: number | null; startedAt: string | null; channelName: string | null }[];
}

const WORKS_BY_SEASON = /* GraphQL */ `
  query WorksBySeason($season: String!, $after: String) {
    searchWorks(seasons: [$season], orderBy: { field: WATCHERS_COUNT, direction: DESC }, first: 50, after: $after) {
      pageInfo { hasNextPage endCursor }
      nodes {
        annictId
        title
        titleKana
        titleEn
        seasonYear
        seasonName
        officialSiteUrl
        media
        image { recommendedImageUrl facebookOgImageUrl }
        episodes(first: 100, orderBy: { field: SORT_NUMBER, direction: ASC }) {
          nodes { annictId number numberText title }
        }
        casts(first: 100) { nodes { name character { name } } }
        staffs(first: 100) { nodes { roleText name } }
        programs(first: 100) { nodes { scPid startedAt channel { name } } }
      }
    }
  }
`;

async function gql<T>(query: string, variables: Record<string, unknown>): Promise<T> {
  const token = process.env.ANNICT_TOKEN;
  if (!token) throw new Error("ANNICT_TOKEN is not set");
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) throw new Error(`Annict API error: ${res.status} ${await res.text()}`);
  const json = await res.json();
  if (json.errors) throw new Error(`Annict GraphQL error: ${JSON.stringify(json.errors)}`);
  return json.data as T;
}

/** "2026-spring" 形式のシーズンslugを受け取り作品一覧を取得 */
export async function fetchWorksBySeason(seasonSlug: string): Promise<AnnictWork[]> {
  const works: AnnictWork[] = [];
  let after: string | null = null;
  // 安全のため最大5ページ
  for (let i = 0; i < 5; i++) {
    const data: any = await gql(WORKS_BY_SEASON, { season: seasonSlug, after });
    const conn = data.searchWorks;
    for (const n of conn.nodes) {
      works.push({
        annictId: n.annictId,
        title: n.title,
        titleKana: n.titleKana || null,
        titleEn: n.titleEn || null,
        seasonYear: n.seasonYear ?? null,
        seasonName: n.seasonName ?? null,
        officialSiteUrl: n.officialSiteUrl || null,
        synopsis: null, // Annictはあらすじを直接持たないため別途補完（公式/Wikipedia等）
        imageUrl: n.image?.recommendedImageUrl || n.image?.facebookOgImageUrl || null,
        media: n.media ? String(n.media).toLowerCase() : null,
        episodes: (n.episodes?.nodes ?? []).map((e: any) => ({
          annictId: e.annictId,
          number: e.number ?? null,
          numberText: e.numberText || null,
          title: e.title || null,
        })),
        casts: (n.casts?.nodes ?? []).map((c: any) => ({
          name: c.name,
          character: c.character?.name ?? "",
        })),
        staffs: (n.staffs?.nodes ?? []).map((s: any) => ({
          roleText: s.roleText,
          name: s.name,
        })),
        programs: (n.programs?.nodes ?? []).map((p: any) => ({
          scPid: p.scPid ?? null,
          startedAt: p.startedAt ?? null,
          channelName: p.channel?.name ?? null,
        })),
      });
    }
    if (!conn.pageInfo.hasNextPage) break;
    after = conn.pageInfo.endCursor;
  }
  return works;
}

/** Annictのシーズン名(SPRING) → 小文字(spring) */
export function normalizeSeasonName(name: string | null): string | null {
  if (!name) return null;
  return name.toLowerCase();
}
