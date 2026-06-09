import type {
  WorkDetail,
  WorkListResult,
  WorkQuery,
  Season,
  ScheduleEntry,
} from "../types.ts";

/**
 * データ取得の抽象インターフェース。
 * 画面/APIはこの interface だけに依存し、実体（seed / supabase）を差し替え可能にする。
 * （docs/10 アーキテクチャ「原則①」に対応）
 */
export interface DataProvider {
  listWorks(query: WorkQuery): Promise<WorkListResult>;
  getWork(id: string): Promise<WorkDetail | null>;
  listSeasons(): Promise<{ slug: string; year: number; season: Season; count: number }[]>;
  listGenres(): Promise<string[]>;
  /** ミニ番組表：放送中TV作品の次回放送を返す */
  getSchedule(): Promise<ScheduleEntry[]>;
  /** 直近の放送（この後の放送）を早い順に返す（1作品1件） */
  getUpcomingBroadcasts(limit: number): Promise<ScheduleEntry[]>;
}

let cached: DataProvider | null = null;

export async function getDataProvider(): Promise<DataProvider> {
  if (cached) return cached;
  const provider = process.env.DATA_PROVIDER ?? "seed";
  if (provider === "supabase" && process.env.NEXT_PUBLIC_SUPABASE_URL) {
    const { SupabaseDataProvider } = await import("./supabase-provider");
    cached = new SupabaseDataProvider();
  } else {
    const { SeedDataProvider } = await import("./seed-provider");
    cached = new SeedDataProvider();
  }
  return cached;
}
