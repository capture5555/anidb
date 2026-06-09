import type { DataProvider } from "./provider.ts";
import { getAdminClient } from "../supabase/admin.ts";
import type {
  Season,
  WorkDetail,
  WorkListResult,
  WorkQuery,
  WorkSummary,
} from "../types.ts";
import { nextSeason, seasonOf, seasonSlug } from "../season.ts";
import { airSlot } from "../format.ts";
import type { ScheduleEntry } from "../types.ts";

const CH_PRIORITY = ["TOKYO MX", "テレビ東京", "テレビ朝日", "日本テレビ", "TBS", "フジテレビ", "NHK", "BS11", "AT-X"];
function chRank(name: string | null): number {
  if (!name) return 99;
  const i = CH_PRIORITY.findIndex((p) => name.includes(p));
  return i < 0 ? 90 : i;
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
      .select("id, title, title_kana, key_visual_url, poster_url, season_year, season_name, status, media, popularity, work_genres(genres(name))", {
        count: "exact",
      });

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
    // 人気順（Annictウォッチャー数の降順）。同数はタイトル読みで安定化。
    q = q
      .range(from, from + perPage - 1)
      .order("popularity", { ascending: false })
      .order("title_kana", { ascending: true });

    const { data, error, count } = await q;
    if (error) throw error;

    const items: WorkSummary[] = (data ?? []).map((row: any) => ({
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

  async getSchedule(): Promise<ScheduleEntry[]> {
    const now = new Date();
    const nowIso = now.toISOString();
    const horizon = new Date(now.getTime() + 8 * 86400000).toISOString();
    const { data, error } = await this.db
      .from("programs")
      .select(
        "start_at, count, channels(name), works!inner(id, title, poster_url, key_visual_url, status, media, popularity)",
      )
      .gte("start_at", nowIso)
      .lte("start_at", horizon)
      .eq("is_rebroadcast", false)
      .eq("works.status", "airing")
      .order("start_at", { ascending: true })
      .limit(8000);
    if (error) throw error;

    // 作品ごとに「最も早い放送（同時刻ならキー局）」を代表として1件に集約（映画は除外）
    const byWork = new Map<string, any>();
    for (const p of data ?? []) {
      if ((p as any).works.media === "movie") continue;
      const id = (p as any).works.id;
      const cur = byWork.get(id);
      if (!cur) {
        byWork.set(id, p);
      } else if (
        p.start_at < cur.start_at ||
        (p.start_at === cur.start_at && chRank((p as any).channels?.name) < chRank(cur.channels?.name))
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

  async getUpcomingBroadcasts(limit: number): Promise<ScheduleEntry[]> {
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
      .limit(300);
    const seen = new Set<string>();
    const out: ScheduleEntry[] = [];
    for (const p of (data ?? []) as any[]) {
      if (p.works.media === "movie") continue;
      if (seen.has(p.works.id)) continue;
      seen.add(p.works.id);
      out.push({
        workId: p.works.id,
        title: p.works.title,
        posterUrl: p.works.poster_url ?? p.works.key_visual_url,
        weekday: airSlot(p.start_at).weekday,
        startAt: p.start_at,
        channelName: p.channels?.name ?? null,
        count: p.count,
        popularity: p.works.popularity ?? 0,
      });
      if (out.length >= limit) break;
    }
    return out;
  }
}
