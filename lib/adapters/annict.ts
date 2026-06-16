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
  releasedOn: string | null; // 公開日（YYYY-MM-DD）。映画のカレンダー登録に使う。
  releasedOnAbout: string | null; // 公開日の曖昧表記（「2026年春」等）
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

// 公開日フィールド。古いAnnictスキーマには無い可能性があるため、エラー時は
// fetchWorksBySeason 側でこのフィールドを外して再試行する（ingestを止めない）。
const RELEASE_FIELDS = "releasedOn\n        releasedOnAbout";

/** シーズン取得クエリを組み立てる。metaOnly=エピソード/放送回を省く。withRelease=公開日フィールドを含む。 */
function worksBySeasonQuery(metaOnly: boolean, withRelease: boolean): string {
  const release = withRelease ? RELEASE_FIELDS : "";
  const detail = metaOnly
    ? ""
    : `
        episodes(first: 100, orderBy: { field: SORT_NUMBER, direction: ASC }) {
          nodes { annictId number numberText title }
        }
        programs(first: 200) {
          nodes {
            annictId
            scPid
            startedAt
            rebroadcast
            channel { name }
          }
        }`;
  return /* GraphQL */ `
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
          ${release}
          watchersCount
          image { recommendedImageUrl facebookOgImageUrl }
          casts(first: 100) { nodes { name character { name } } }
          staffs(first: 100) { nodes { roleText name } }${detail}
        }
      }
    }
  `;
}

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
  const metaOnly = opts.metaOnly ?? false;
  // 公開日フィールドが古いスキーマに無い場合、初回エラーで外して再試行する。
  let withRelease = true;
  // 安全のため最大5ページ
  for (let i = 0; i < 5; i++) {
    let data: any;
    try {
      data = await gql(worksBySeasonQuery(metaOnly, withRelease), { season: seasonSlug, after });
    } catch (e) {
      if (withRelease) {
        // releasedOn 非対応スキーマとみなし、フィールドを外して再試行
        withRelease = false;
        data = await gql(worksBySeasonQuery(metaOnly, false), { season: seasonSlug, after });
      } else {
        throw e;
      }
    }
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
        releasedOn: n.releasedOn || null,
        releasedOnAbout: n.releasedOnAbout || null,
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

// ============================================================
//  話数別統計（アナリティクス収集用）
//  フィールド名は introspection で確認済み:
//  Episode { recordsCount, recordCommentsCount, satisfactionRate }
//  Work { watchersCount, reviewsCount, satisfactionRate }
// ============================================================

export interface AnnictEpisodeStat {
  annictEpisodeId: number;
  recordsCount: number;
  recordCommentsCount: number;
  satisfactionRate: number | null;
}

export interface AnnictWorkStat {
  annictWorkId: number;
  watchersCount: number;
  reviewsCount: number;
  satisfactionRate: number | null;
  episodes: AnnictEpisodeStat[];
}

const STATS_BY_SEASON = /* GraphQL */ `
  query StatsBySeason($season: String!, $after: String) {
    searchWorks(seasons: [$season], orderBy: { field: WATCHERS_COUNT, direction: DESC }, first: 50, after: $after) {
      pageInfo { hasNextPage endCursor }
      nodes {
        annictId
        watchersCount
        reviewsCount
        satisfactionRate
        episodes(first: 100, orderBy: { field: SORT_NUMBER, direction: ASC }) {
          nodes { annictId recordsCount recordCommentsCount satisfactionRate }
        }
      }
    }
  }
`;

/** シーズン内全作品の 話数別記録数/作品ベースライン を取得（GraphQL。失敗時は REST v1 フォールバック） */
export async function fetchSeasonStats(seasonSlug: string): Promise<AnnictWorkStat[]> {
  try {
    const stats: AnnictWorkStat[] = [];
    let after: string | null = null;
    for (let i = 0; i < 5; i++) {
      const data: any = await gql(STATS_BY_SEASON, { season: seasonSlug, after });
      const conn = data.searchWorks;
      for (const n of conn.nodes) {
        stats.push({
          annictWorkId: n.annictId,
          watchersCount: n.watchersCount ?? 0,
          reviewsCount: n.reviewsCount ?? 0,
          satisfactionRate: n.satisfactionRate ?? null,
          episodes: (n.episodes?.nodes ?? []).map((e: any) => ({
            annictEpisodeId: e.annictId,
            recordsCount: e.recordsCount ?? 0,
            recordCommentsCount: e.recordCommentsCount ?? 0,
            satisfactionRate: e.satisfactionRate ?? null,
          })),
        });
      }
      if (!conn.pageInfo.hasNextPage) break;
      after = conn.pageInfo.endCursor;
    }
    return stats;
  } catch (e) {
    console.warn(`[annict] GraphQL stats failed, falling back to REST v1: ${e}`);
    return fetchSeasonStatsRest(seasonSlug);
  }
}

/** REST v1 フォールバック（GraphQL障害時用。episodes はページング取得） */
async function fetchSeasonStatsRest(seasonSlug: string): Promise<AnnictWorkStat[]> {
  const token = process.env.ANNICT_TOKEN;
  if (!token) throw new Error("ANNICT_TOKEN is not set");
  const stats: AnnictWorkStat[] = [];

  for (let page = 1; page <= 10; page++) {
    const res = await fetch(
      `https://api.annict.com/v1/works?filter_season=${seasonSlug}&sort_watchers_count=desc&per_page=50&page=${page}&access_token=${token}`,
    );
    if (!res.ok) throw new Error(`Annict REST works failed: ${res.status}`);
    const json: any = await res.json();
    const works: any[] = json.works ?? [];
    for (const w of works) {
      const episodes: AnnictEpisodeStat[] = [];
      for (let ep = 1; ep <= 4; ep++) {
        const er = await fetch(
          `https://api.annict.com/v1/episodes?filter_work_id=${w.id}&per_page=50&page=${ep}&access_token=${token}`,
        );
        if (!er.ok) break;
        const ej: any = await er.json();
        for (const e of ej.episodes ?? []) {
          episodes.push({
            annictEpisodeId: e.id,
            recordsCount: e.records_count ?? 0,
            recordCommentsCount: e.record_comments_count ?? 0,
            satisfactionRate: e.satisfaction_rate ?? null,
          });
        }
        if ((ej.episodes ?? []).length < 50) break;
      }
      stats.push({
        annictWorkId: w.id,
        watchersCount: w.watchers_count ?? 0,
        reviewsCount: w.reviews_count ?? 0,
        satisfactionRate: null,
        episodes,
      });
    }
    if (works.length < 50) break;
  }
  return stats;
}
