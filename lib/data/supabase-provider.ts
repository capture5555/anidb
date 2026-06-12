import type { DataProvider } from "./provider.ts";
import { getAdminClient } from "../supabase/admin.ts";
import type {
  Season,
  WorkDetail,
  WorkListResult,
  WorkQuery,
  WorkSummary,
} from "../types.ts";
import { nextSeason, seasonOf, seasonSlug, SEASON_ORDER } from "../season.ts";
import { NON_WORK_OR_FILTER, isNonWork } from "../nonWork.ts";
import { airSlot } from "../format.ts";
import { channelMatches, channelRankBy } from "../channels.ts";
import type { ScheduleEntry } from "../types.ts";

const CH_PRIORITY = ["TOKYO MX", "テレビ東京", "テレビ朝日", "日本テレビ", "TBS", "フジテレビ", "NHK", "BS11", "AT-X"];
function chRank(name: string | null): number {
  if (!name) return 99;
  const i = CH_PRIORITY.findIndex((p) => name.includes(p));
  return i < 0 ? 90 : i;
}

/** クール(season_year, season_name)を時系列の数値キーへ。未定は null。 */
function seasonSortKey(row: { season_year: number | null; season_name: string | null }): number | null {
  if (!row.season_year || !row.season_name) return null;
  const idx = SEASON_ORDER.indexOf(row.season_name as (typeof SEASON_ORDER)[number]);
  if (idx < 0) return null;
  return row.season_year * 10 + idx;
}

/**
 * 取得済みの作品行を映画タブの並び替え種別に従ってJSで整列する。
 * 未指定/"popular" はDB既定順（人気順）のまま返す。
 */
function sortWorkRows<T extends {
  title_kana: string | null;
  created_at?: string | null;
  season_year: number | null;
  season_name: string | null;
  status: string;
}>(rows: T[], sort: WorkQuery["sort"]): T[] {
  if (!sort || sort === "popular") return rows;
  const arr = [...rows];
  if (sort === "newest") {
    arr.sort((a, b) => (b.created_at ?? "").localeCompare(a.created_at ?? ""));
  } else if (sort === "kana") {
    arr.sort((a, b) => (a.title_kana ?? "～").localeCompare(b.title_kana ?? "～", "ja"));
  } else if (sort === "upcoming") {
    // 公開予定が近い順: 未公開/放送中を近いクール順で先頭に、公開済みは新しい順で後ろに。
    const rank = (r: T) => (r.status === "finished" ? 1 : 0);
    arr.sort((a, b) => {
      const ra = rank(a);
      const rb = rank(b);
      if (ra !== rb) return ra - rb;
      const ka = seasonSortKey(a);
      const kb = seasonSortKey(b);
      if (ka == null) return kb == null ? 0 : 1;
      if (kb == null) return -1;
      return ra === 1 ? kb - ka : ka - kb; // 公開済みは降順、未公開は昇順
    });
  }
  return arr;
}

/**
 * Supabase(PostgreSQL)バックエンド実装。
 * テーブル定義は supabase/migrations/0001_init.sql に対応。
 */
export class SupabaseDataProvider implements DataProvider {
  private db = getAdminClient();

  async listWorks(query: WorkQuery): Promise<WorkListResult> {
    const now = new Date();
    const cur = seasonOf(now);
    const nxt = nextSeason(cur.year, cur.season);

    let q = this.db
      .from("works")
      .select("id, title, title_kana, key_visual_url, poster_url, season_year, season_name, status, media, popularity, created_at, work_genres(genres(name))", {
        count: "exact",
      });

    // 非作品（PV/CM/プロモ/音楽/ピッコマ等）をサイト全体で除外
    q = q.or(NON_WORK_OR_FILTER);

    // media が null の作品も除外されないよう「movie以外 or null」で映画を除く
    const notMovie = "media.neq.movie,media.is.null";
    if (query.tab === "this_season") {
      q = q.eq("season_year", cur.year).eq("season_name", cur.season).or(notMovie);
    } else if (query.tab === "next_season") {
      q = q.eq("season_year", nxt.year).eq("season_name", nxt.season).or(notMovie);
    } else if (query.tab === "movie") {
      q = q.eq("media", "movie");
    }

    if (query.season) {
      const parsed = query.season.match(/^(\d{4})-(\w+)$/);
      if (parsed) q = q.eq("season_year", Number(parsed[1])).eq("season_name", parsed[2]);
    }
    if (query.status) q = q.eq("status", query.status);
    if (query.q) q = q.ilike("title", `%${query.q}%`);

    const perPage = query.perPage ?? 24;
    const page = query.page ?? 1;
    const from = (page - 1) * perPage;
    // DB側の既定順は人気順（Annictウォッチャー数の降順）。同数はタイトル読みで安定化。
    // 映画タブの「新着順/公開予定が近い順/タイトル順」はクール時系列を含むため取得後にJSで並べ替える。
    q = q
      .range(from, from + perPage - 1)
      .order("popularity", { ascending: false })
      .order("title_kana", { ascending: true });

    const { data, error, count } = await q;
    if (error) throw error;

    const rows = sortWorkRows(data ?? [], query.sort);
    const items: WorkSummary[] = rows.map((row: any) => ({
      id: row.id,
      title: row.title,
      titleKana: row.title_kana,
      keyVisualUrl: row.poster_url ?? row.key_visual_url,
      seasonYear: row.season_year,
      seasonName: row.season_name,
      status: row.status,
      media: row.media,
      popularity: row.popularity ?? 0,
      genres: (row.work_genres ?? []).map((wg: any) => wg.genres?.name).filter(Boolean),
    }));

    const total = count ?? items.length;
    return { items, page, perPage, total, hasNext: from + perPage < total };
  }

  async getWork(id: string): Promise<WorkDetail | null> {
    const { data: w, error } = await this.db
      .from("works")
      .select(
        "*, work_genres(genres(name)), episodes(*), work_casts(*), work_staff(*), programs(*, channels(name))",
      )
      .eq("id", id)
      .maybeSingle();
    if (error) throw error;
    if (!w) return null;

    return {
      id: w.id,
      title: w.title,
      titleKana: w.title_kana,
      titleEn: w.title_en,
      keyVisualUrl: w.poster_url ?? w.key_visual_url,
      seasonYear: w.season_year,
      seasonName: w.season_name,
      status: w.status,
      media: w.media,
      popularity: w.popularity ?? 0,
      anilistScore: w.anilist_score ?? null,
      anilistPopularity: w.anilist_popularity ?? null,
      malScore: w.mal_score != null ? Number(w.mal_score) : null,
      malScoredBy: w.mal_scored_by ?? null,
      malMembers: w.mal_members ?? null,
      genres: (w.work_genres ?? []).map((wg: any) => wg.genres?.name).filter(Boolean),
      synopsis: w.synopsis,
      officialSiteUrl: w.official_site_url,
      episodes: (w.episodes ?? [])
        .map((e: any) => ({
          id: e.id,
          workId: e.work_id,
          number: e.number,
          numberText: e.number_text,
          title: e.title,
          titleSource: e.title_source,
          sort: e.sort,
        }))
        .sort((a: any, b: any) => a.sort - b.sort),
      casts: (w.work_casts ?? [])
        .map((c: any) => ({
          id: c.id,
          characterName: c.character_name,
          personName: c.person_name,
          personId: c.person_id,
          sort: c.sort,
        }))
        .sort((a: any, b: any) => a.sort - b.sort),
      staff: (w.work_staff ?? [])
        .map((s: any) => ({
          id: s.id,
          role: s.role,
          personName: s.person_name,
          personId: s.person_id,
          sort: s.sort,
        }))
        .sort((a: any, b: any) => a.sort - b.sort),
      programs: (w.programs ?? [])
        .map((p: any) => ({
          id: p.id,
          workId: p.work_id,
          episodeId: p.episode_id,
          channelId: p.channel_id,
          channelName: p.channels?.name ?? null,
          count: p.count,
          startAt: p.start_at,
          endAt: p.end_at,
          isRebroadcast: p.is_rebroadcast,
          syoboiPid: p.syoboi_pid,
        }))
        .sort((a: any, b: any) => a.startAt.localeCompare(b.startAt)),
    };
  }

  async listSeasons() {
    const { data, error } = await this.db
      .from("works")
      .select("season_year, season_name")
      .not("season_year", "is", null);
    if (error) throw error;
    const map = new Map<string, { slug: string; year: number; season: Season; count: number }>();
    for (const row of data ?? []) {
      const slug = seasonSlug(row.season_year, row.season_name);
      const cur = map.get(slug);
      if (cur) cur.count++;
      else map.set(slug, { slug, year: row.season_year, season: row.season_name, count: 1 });
    }
    return Array.from(map.values()).sort((a, b) => b.year - a.year || b.season.localeCompare(a.season));
  }

  async listGenres() {
    const { data, error } = await this.db.from("genres").select("name").order("name");
    if (error) throw error;
    return (data ?? []).map((g: any) => g.name);
  }

  async getSchedule(
    channels: string[] = [],
    scope: "current" | "next" = "current",
  ): Promise<ScheduleEntry[]> {
    const now = new Date();
    const nowIso = now.toISOString();
    // 今期は直近8日、来季は次クール開始までを見込んで120日先まで
    const horizonDays = scope === "next" ? 120 : 8;
    const horizon = new Date(now.getTime() + horizonDays * 86400000).toISOString();
    let qb = this.db
      .from("programs")
      .select(
        "start_at, count, channels(name), works!inner(id, title, poster_url, key_visual_url, status, media, popularity, season_year, season_name)",
      )
      .gte("start_at", nowIso)
      .lte("start_at", horizon)
      .eq("is_rebroadcast", false);
    if (scope === "next") {
      const nxt = nextSeason(seasonOf(now).year, seasonOf(now).season);
      qb = qb
        .eq("works.season_year", nxt.year)
        .eq("works.season_name", nxt.season)
        .neq("works.status", "finished");
    } else {
      qb = qb.eq("works.status", "airing");
    }
    const { data, error } = await qb.order("start_at", { ascending: true }).limit(8000);
    if (error) throw error;

    // 作品ごとに「選択局の代表局で最も早い放送」を代表として1件に集約（映画・配信・対象外ローカルは除外）
    const byWork = new Map<string, any>();
    for (const p of data ?? []) {
      if ((p as any).works.media === "movie") continue;
      if (isNonWork((p as any).works)) continue;
      if (!channelMatches((p as any).channels?.name ?? null, channels)) continue;
      const id = (p as any).works.id;
      const cur = byWork.get(id);
      if (!cur) {
        byWork.set(id, p);
      } else if (
        p.start_at < cur.start_at ||
        (p.start_at === cur.start_at &&
          channelRankBy((p as any).channels?.name ?? null, channels) <
            channelRankBy(cur.channels?.name ?? null, channels))
      ) {
        byWork.set(id, p);
      }
    }

    return [...byWork.values()].map((p: any) => ({
      workId: p.works.id,
      title: p.works.title,
      posterUrl: p.works.poster_url ?? p.works.key_visual_url,
      weekday: airSlot(p.start_at).weekday,
      startAt: p.start_at,
      channelName: p.channels?.name ?? null,
      count: p.count,
      popularity: p.works.popularity ?? 0,
    }));
  }

  async getUpcomingBroadcasts(limit: number, channels: string[] = []): Promise<ScheduleEntry[]> {
    const nowIso = new Date().toISOString();
    const { data } = await this.db
      .from("programs")
      .select(
        "start_at, count, channels(name), works!inner(id, title, poster_url, key_visual_url, status, media, popularity)",
      )
      .gte("start_at", nowIso)
      .eq("is_rebroadcast", false)
      .eq("works.status", "airing")
      .order("start_at", { ascending: true })
      .limit(400);

    // 作品ごとに「選択局の代表局でいちばん早い放送」を選ぶ。
    // 同じ作品が複数局・複数回ある中から、選択局の優先度→放送が早い順で1件に絞る。
    const repByWork = new Map<string, ScheduleEntry>();
    const rankByWork = new Map<string, number>();
    for (const p of (data ?? []) as any[]) {
      if (p.works.media === "movie") continue;
      if (isNonWork(p.works)) continue;
      // ネット配信・対象外ローカル局は「この後の放送」に出さない
      if (!channelMatches(p.channels?.name ?? null, channels)) continue;
      const id = p.works.id as string;
      const rank = channelRankBy(p.channels?.name ?? null, channels);
      const prevRank = rankByWork.get(id);
      // より優先度の高い局があればそれを採用（同順位は先に来た＝早い放送を維持）
      if (prevRank != null && rank >= prevRank) continue;
      rankByWork.set(id, rank);
      repByWork.set(id, {
        workId: id,
        title: p.works.title,
        posterUrl: p.works.poster_url ?? p.works.key_visual_url,
        weekday: airSlot(p.start_at).weekday,
        startAt: p.start_at,
        channelName: p.channels?.name ?? null,
        count: p.count,
        popularity: p.works.popularity ?? 0,
      });
    }

    return [...repByWork.values()]
      .sort((a, b) => a.startAt.localeCompare(b.startAt))
      .slice(0, limit);
  }
}
