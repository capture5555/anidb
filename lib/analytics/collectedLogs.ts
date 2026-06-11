/**
 * Shared memoized helper: fetches all analytics_collection_log rows with status='collected'
 * and comment_count > 0, returning { program_id, comment_count }[].
 *
 * Multiple live-fallback functions (getJikkyoRetentionSeriesLive, getReactionRatiosLive,
 * getCohortReactionAverageUncached, buildScorecard) each independently scanned this table,
 * which multiplied cold-path DB cost. This module centralises the scan under a 5-minute
 * in-process TTL cache so a single render only pays for it once.
 */
import { getAdminClient } from "../supabase/admin.ts";
import { memoizeTTL } from "../cache.ts";

export interface CollectedLogRow {
  program_id: string;
  comment_count: number;
}

async function fetchCollectedLogs(): Promise<CollectedLogRow[]> {
  const db = getAdminClient();
  const rows: CollectedLogRow[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db
      .from("analytics_collection_log")
      .select("program_id, comment_count")
      .eq("status", "collected")
      .gt("comment_count", 0)
      .range(from, from + 999);
    if (error) break;
    rows.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  return rows;
}

/**
 * Memoized for 5 minutes (300_000 ms). All live-fallback analytics functions share this
 * result so the table is only scanned once per TTL window rather than once per function.
 * The key is constant since there are no arguments.
 */
export const getCollectedLogs = memoizeTTL(
  fetchCollectedLogs,
  () => "collected_logs",
  300_000,
);
