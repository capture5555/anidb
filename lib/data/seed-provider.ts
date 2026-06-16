import type { DataProvider } from "./provider.ts";
import { SEED_WORKS } from "./seed-data.ts";
import type {
  Season,
  WorkDetail,
  WorkListResult,
  WorkQuery,
  WorkSummary,
} from "../types.ts";
import { nextSeason, seasonOf, seasonSlug, SEASON_ORDER } from "../season.ts";
import { airSlot } from "../format.ts";
import { channelMatches, channelRankBy } from "../channels.ts";
import { isNonWork, isExcludedListMedia, mediaAllowedInList } from "../nonWork.ts";
import type { ScheduleEntry } from "../types.ts";

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
    popularity: w.popularity,
    releasedOn: w.releasedOn ?? null,
    releasedOnAbout: w.releasedOnAbout ?? null,
    genres: w.genres,
  };
}

export class SeedDataProvider implements DataProvider {
  async listWorks(query: WorkQuery): Promise<WorkListResult> {
    const now = new Date();
    const cur = seasonOf(now);
    const nxt = nextSeason(cur.year, cur.season);

    // 非作品（PV/CM/プロモ/ピッコマ/ゲーム宣伝等）と対象外media（ova/web/other）を除外。
    // media不明(null)は放送枠(programs)があれば残す。
    let items = SEED_WORKS.filter(
      (w) => !isNonWork(w) && mediaAllowedInList(w.media, (w.programs?.length ?? 0) > 0),
    );

    if (query.tab) {
      switch (query.tab) {
        case "this_season":
          items = items.filter(
            (w) => w.seasonYear === cur.year && w.seasonName === cur.season && w.media !== "movie",
          );
          break;
        case "next_season":
          items = items.filter(
            (w) => w.seasonYear === nxt.year && w.seasonName === nxt.season && w.media !== "movie",
          );
          break;
        case "movie":
          items = items.filter((w) => w.media === "movie");
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

    if (query.sort && query.sort !== "popular") {
      const seasonKey = (w: WorkDetail) =>
        w.seasonYear && w.seasonName ? w.seasonYear * 10 + SEASON_ORDER.indexOf(w.seasonName) : null;
      if (query.sort === "newest") {
        // seed には created_at が無いため人気度の高い順を新着の代理とする
        items.sort((a, b) => b.popularity - a.popularity);
      } else if (query.sort === "kana") {
        items.sort((a, b) => (a.titleKana ?? "～").localeCompare(b.titleKana ?? "～", "ja"));
      } else if (query.sort === "upcoming") {
        const rank = (w: WorkDetail) => (w.status === "finished" ? 1 : 0);
        items.sort((a, b) => {
          if (rank(a) !== rank(b)) return rank(a) - rank(b);
          const ka = seasonKey(a);
          const kb = seasonKey(b);
          if (ka == null) return kb == null ? 0 : 1;
          if (kb == null) return -1;
          return rank(a) === 1 ? kb - ka : ka - kb;
        });
      }
    } else if (query.sort === "popular") {
      items.sort((a, b) => b.popularity - a.popularity);
    } else {
      // 既定: 放送中 > 放送予定 > 終了、同status内はタイトル読み
      const statusRank: Record<string, number> = { airing: 0, upcoming: 1, finished: 2 };
      items.sort((a, b) => {
        const r = (statusRank[a.status] ?? 9) - (statusRank[b.status] ?? 9);
        if (r !== 0) return r;
        return (a.titleKana ?? a.title).localeCompare(b.titleKana ?? b.title, "ja");
      });
    }

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

  async getSchedule(
    channels: string[] = [],
    scope: "current" | "next" = "current",
  ): Promise<ScheduleEntry[]> {
    const now = Date.now();
    const nxt = nextSeason(seasonOf(new Date()).year, seasonOf(new Date()).season);
    const entries: ScheduleEntry[] = [];
    for (const w of SEED_WORKS) {
      if (w.media === "movie" || isExcludedListMedia(w.media) || isNonWork(w)) continue;
      if (scope === "next") {
        if (w.status === "finished") continue;
        if (w.seasonYear !== nxt.year || w.seasonName !== nxt.season) continue;
      } else if (w.status !== "airing") {
        continue;
      }
      // 選択局（空なら配信以外の全放送波）で最も早い放送を代表に選ぶ。
      const next = w.programs
        .filter(
          (p) =>
            !p.isRebroadcast &&
            new Date(p.startAt).getTime() >= now &&
            channelMatches(p.channelName, channels),
        )
        .sort(
          (a, b) =>
            channelRankBy(a.channelName, channels) - channelRankBy(b.channelName, channels) ||
            a.startAt.localeCompare(b.startAt),
        )[0];
      if (!next) continue;
      entries.push({
        workId: w.id,
        title: w.title,
        posterUrl: w.keyVisualUrl,
        weekday: airSlot(next.startAt).weekday,
        startAt: next.startAt,
        channelName: next.channelName,
        count: next.count,
        popularity: w.popularity,
      });
    }
    return entries;
  }

  async getUpcomingBroadcasts(limit: number, channels: string[] = []): Promise<ScheduleEntry[]> {
    const all = await this.getSchedule(channels);
    return all.sort((a, b) => a.startAt.localeCompare(b.startAt)).slice(0, limit);
  }
}
