import type { DataProvider } from "./provider";
import { SEED_WORKS } from "./seed-data";
import type {
  Season,
  WorkDetail,
  WorkListResult,
  WorkQuery,
  WorkSummary,
} from "@/lib/types";
import { nextSeason, seasonOf, seasonSlug } from "@/lib/season";

function toSummary(w: WorkDetail): WorkSummary {
  return {
    id: w.id,
    title: w.title,
    titleKana: w.titleKana,
    keyVisualUrl: w.keyVisualUrl,
    seasonYear: w.seasonYear,
    seasonName: w.seasonName,
    status: w.status,
    media: w.media,
    genres: w.genres,
  };
}

export class SeedDataProvider implements DataProvider {
  async listWorks(query: WorkQuery): Promise<WorkListResult> {
    const now = new Date();
    const cur = seasonOf(now);
    const nxt = nextSeason(cur.year, cur.season);

    let items = SEED_WORKS.slice();

    if (query.tab) {
      switch (query.tab) {
        case "this_season":
          items = items.filter(
            (w) => w.seasonYear === cur.year && w.seasonName === cur.season,
          );
          break;
        case "next_season":
          items = items.filter(
            (w) => w.seasonYear === nxt.year && w.seasonName === nxt.season,
          );
          break;
        case "airing":
          items = items.filter((w) => w.status === "airing");
          break;
        case "upcoming":
          items = items.filter((w) => w.status === "upcoming");
          break;
      }
    }

    if (query.season) {
      items = items.filter(
        (w) => w.seasonYear && seasonSlug(w.seasonYear, w.seasonName as Season) === query.season,
      );
    }
    if (query.status) items = items.filter((w) => w.status === query.status);
    if (query.genre) items = items.filter((w) => w.genres.includes(query.genre!));
    if (query.q) {
      const q = query.q.toLowerCase();
      items = items.filter(
        (w) =>
          w.title.toLowerCase().includes(q) ||
          (w.titleKana ?? "").toLowerCase().includes(q) ||
          (w.titleEn ?? "").toLowerCase().includes(q),
      );
    }

    // 並び: 放送中 > 放送予定 > 終了、同status内はタイトル読み
    const statusRank: Record<string, number> = { airing: 0, upcoming: 1, finished: 2 };
    items.sort((a, b) => {
      const r = (statusRank[a.status] ?? 9) - (statusRank[b.status] ?? 9);
      if (r !== 0) return r;
      return (a.titleKana ?? a.title).localeCompare(b.titleKana ?? b.title, "ja");
    });

    const perPage = query.perPage ?? 24;
    const page = query.page ?? 1;
    const total = items.length;
    const start = (page - 1) * perPage;
    const paged = items.slice(start, start + perPage).map(toSummary);

    return { items: paged, page, perPage, total, hasNext: start + perPage < total };
  }

  async getWork(id: string): Promise<WorkDetail | null> {
    return SEED_WORKS.find((w) => w.id === id) ?? null;
  }

  async listSeasons() {
    const map = new Map<string, { slug: string; year: number; season: Season; count: number }>();
    for (const w of SEED_WORKS) {
      if (!w.seasonYear || !w.seasonName) continue;
      const slug = seasonSlug(w.seasonYear, w.seasonName);
      const cur = map.get(slug);
      if (cur) cur.count++;
      else map.set(slug, { slug, year: w.seasonYear, season: w.seasonName, count: 1 });
    }
    return Array.from(map.values()).sort((a, b) =>
      b.year - a.year || b.season.localeCompare(a.season),
    );
  }

  async listGenres() {
    const set = new Set<string>();
    for (const w of SEED_WORKS) w.genres.forEach((g) => set.add(g));
    return Array.from(set).sort((a, b) => a.localeCompare(b, "ja"));
  }
}
