import type { DataProvider } from "./provider";
import { getAdminClient } from "@/lib/supabase/admin";
import type {
  Season,
  WorkDetail,
  WorkListResult,
  WorkQuery,
  WorkSummary,
} from "@/lib/types";
import { nextSeason, seasonOf, seasonSlug } from "@/lib/season";

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
      .select("id, title, title_kana, key_visual_url, season_year, season_name, status, media, work_genres(genres(name))", {
        count: "exact",
      });

    if (query.tab === "this_season") {
      q = q.eq("season_year", cur.year).eq("season_name", cur.season);
    } else if (query.tab === "next_season") {
      q = q.eq("season_year", nxt.year).eq("season_name", nxt.season);
    } else if (query.tab === "airing") {
      q = q.eq("status", "airing");
    } else if (query.tab === "upcoming") {
      q = q.eq("status", "upcoming");
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
      keyVisualUrl: row.key_visual_url,
      seasonYear: row.season_year,
      seasonName: row.season_name,
      status: row.status,
      media: row.media,
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
      keyVisualUrl: w.key_visual_url,
      seasonYear: w.season_year,
      seasonName: w.season_name,
      status: w.status,
      media: w.media,
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
}
