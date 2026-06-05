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
  watchersCount: number; // 人気指標（ウォッチャー数）
  episodes: { annictId: number; number: number | null; numberText: string | null; title: string | null }[];
  casts: { name: string; character: string }[];
  staffs: { roleText: string; name: string }[];
  /**
   * 放送予定。Annictが startedAt(放送日時) / channel / episode(話数・サブタイトル) / rebroadcast を
   * 直接持っているため、これだけで正確なカレンダー登録ができる（しょぼいカレンダー不要）。
   */
  programs: {
    annictId: number | null;
    scPid: number | null;
    startedAt: string | null;
    rebroadcast: boolean;
    channelName: string | null;
    episodeNumber: number | null;
    episodeNumberText: string | null;
    episodeTitle: string | null;
  }[];
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
        watchersCount
        image { recommendedImageUrl facebookOgImageUrl }
        episodes(first: 100, orderBy: { field: SORT_NUMBER, direction: ASC }) {
          nodes { annictId number numberText title }
        }
        casts(first: 100) { nodes { name character { name } } }
        staffs(first: 100) { nodes { roleText name } }
        programs(first: 200) {
          nodes {
            annictId
            scPid
            startedAt
            rebroadcast
            channel { name }
          }
        }
      }
    }
  }
`;

// 分析用の軽量クエリ（エピソード・放送回を取らない＝過去作品の一括取り込み向け）
const WORKS_BY_SEASON_META = /* GraphQL */ `
  query WorksBySeasonMeta($season: String!, $after: String) {
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
        watchersCount
        image { recommendedImageUrl facebookOgImageUrl }
        casts(first: 100) { nodes { name character { name } } }
        staffs(first: 100) { nodes { roleText name } }
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

/** "2026-spring" 形式のシーズンslugを受け取り作品一覧を取得。metaOnlyでエピソード/放送回を省く。 */
export async function fetchWorksBySeason(
  seasonSlug: string,
  opts: { metaOnly?: boolean } = {},
): Promise<AnnictWork[]> {
  const works: AnnictWork[] = [];
  let after: string | null = null;
  const query = opts.metaOnly ? WORKS_BY_SEASON_META : WORKS_BY_SEASON;
  // 安全のため最大5ページ
  for (let i = 0; i < 5; i++) {
    const data: any = await gql(query, { season: seasonSlug, after });
    const conn = data.searchWorks;
    for (const n of conn.nodes) {
      const work: AnnictWork = {
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
        watchersCount: n.watchersCount ?? 0,
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
          annictId: p.annictId ?? null,
          scPid: p.scPid ?? null,
          startedAt: p.startedAt ?? null,
          rebroadcast: Boolean(p.rebroadcast),
          channelName: p.channel?.name ?? null,
          // episode は Program に直接ぶら下げると null 非許容違反でクエリが落ちるため、
          // 取得後に linkProgramsToEpisodes で対応付ける。
          episodeNumber: null,
          episodeNumberText: null,
          episodeTitle: null,
        })),
      };
      linkProgramsToEpisodes(work);
      works.push(work);
    }
    if (!conn.pageInfo.hasNextPage) break;
    after = conn.pageInfo.endCursor;
  }
  return works;
}

/**
 * 放送回(program)に話数・サブタイトルを対応付ける。
 * Annictの Program.episode は直接取得できない（null非許容違反）ため、
 * 「チャンネルごとに本放送を時系列順に並べ、エピソード一覧(sort順)へ順番に割り当てる」ことで推定する。
 * 週1放送・複数局放送・同日一挙放送のいずれにも対応できる素直な方式。
 */
function linkProgramsToEpisodes(work: AnnictWork): void {
  const epList = work.episodes
    .filter((e) => e.number != null)
    .slice()
    .sort((a, b) => (a.number ?? 0) - (b.number ?? 0));
  if (epList.length === 0) return;

  const byChannel = new Map<string, AnnictWork["programs"]>();
  for (const p of work.programs) {
    if (p.rebroadcast || !p.startedAt) continue;
    const key = p.channelName ?? "_";
    if (!byChannel.has(key)) byChannel.set(key, []);
    byChannel.get(key)!.push(p);
  }

  for (const group of byChannel.values()) {
    group.sort((a, b) => (a.startedAt ?? "").localeCompare(b.startedAt ?? ""));
    group.forEach((p, i) => {
      const ep = epList[i];
      if (ep) {
        p.episodeNumber = ep.number;
        p.episodeNumberText = ep.numberText;
        p.episodeTitle = ep.title;
      }
    });
  }
}

/** Annictのシーズン名(SPRING) → 小文字(spring) */
export function normalizeSeasonName(name: string | null): string | null {
  if (!name) return null;
  return name.toLowerCase();
}
