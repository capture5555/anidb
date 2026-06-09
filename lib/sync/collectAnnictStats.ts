import { getAdminClient } from "../supabase/admin.ts";
import { fetchSeasonStats } from "../adapters/annict.ts";
import { seasonOf, seasonSlug, SEASON_ORDER } from "../season.ts";
import type { Season } from "../types.ts";

/**
 * Annict の話数別記録数を日次スナップショットする（残留率分析の元データ）。
 * - 対象: 今期（＋四半期の初月は前期も。クール跨ぎの最終話の伸びを取りこぼさないため）
 * - 冪等: unique(snapshot_date, episode_id) への upsert なので同日再実行は no-op
 */

export interface CollectStatsResult {
  seasons: string[];
  workStats: number;
  episodeStats: number;
}

function prevSeason(year: number, season: Season): { year: number; season: Season } {
  const idx = SEASON_ORDER.indexOf(season);
  if (idx === 0) return { year: year - 1, season: SEASON_ORDER[SEASON_ORDER.length - 1] };
  return { year, season: SEASON_ORDER[idx - 1] };
}

/** JSTの「今日」（snapshot_date 用） */
function jstToday(): { date: string; month: number } {
  const jst = new Date(Date.now() + 9 * 3600 * 1000);
  return { date: jst.toISOString().slice(0, 10), month: jst.getUTCMonth() + 1 };
}

const chunk = <T,>(arr: T[], size: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
};

export async function collectAnnictStats(): Promise<CollectStatsResult> {
  const db = getAdminClient();
  const { date: snapshotDate, month } = jstToday();

  const cur = seasonOf(new Date(Date.now() + 9 * 3600 * 1000));
  const targets = [seasonSlug(cur.year, cur.season)];
  // 四半期の初月（1,4,7,10月）は前期もスナップショット
  if ([1, 4, 7, 10].includes(month)) {
    const prev = prevSeason(cur.year, cur.season);
    targets.push(seasonSlug(prev.year, prev.season));
  }

  const result: CollectStatsResult = { seasons: targets, workStats: 0, episodeStats: 0 };

  for (const season of targets) {
    const stats = await fetchSeasonStats(season);
    if (stats.length === 0) continue;

    // annict_id → 自前DBのID へ対応付け
    const workIdByAnnict = new Map<number, string>();
    for (const ids of chunk(stats.map((s) => s.annictWorkId), 200)) {
      const { data } = await db.from("works").select("id, annict_id").in("annict_id", ids);
      for (const w of data ?? []) workIdByAnnict.set(Number(w.annict_id), w.id);
    }
    const episodeIdByAnnict = new Map<number, string>();
    for (const ids of chunk([...workIdByAnnict.values()], 100)) {
      const { data } = await db
        .from("episodes")
        .select("id, annict_episode_id")
        .in("work_id", ids)
        .not("annict_episode_id", "is", null);
      for (const e of data ?? []) episodeIdByAnnict.set(Number(e.annict_episode_id), e.id);
    }

    const workRows: any[] = [];
    const episodeRows: any[] = [];
    for (const s of stats) {
      const workId = workIdByAnnict.get(s.annictWorkId);
      if (!workId) continue; // 未ingestの作品はスキップ
      workRows.push({
        snapshot_date: snapshotDate,
        work_id: workId,
        watchers_count: s.watchersCount,
        reviews_count: s.reviewsCount,
        satisfaction_rate: s.satisfactionRate,
      });
      for (const e of s.episodes) {
        const episodeId = episodeIdByAnnict.get(e.annictEpisodeId);
        if (!episodeId) continue;
        episodeRows.push({
          snapshot_date: snapshotDate,
          episode_id: episodeId,
          work_id: workId,
          records_count: e.recordsCount,
          comments_count: e.recordCommentsCount,
          satisfaction_rate: e.satisfactionRate,
        });
      }
    }

    for (const rows of chunk(workRows, 500)) {
      const { error } = await db
        .from("analytics_work_stats")
        .upsert(rows, { onConflict: "snapshot_date,work_id" });
      if (error) throw error;
      result.workStats += rows.length;
    }
    for (const rows of chunk(episodeRows, 500)) {
      const { error } = await db
        .from("analytics_episode_stats")
        .upsert(rows, { onConflict: "snapshot_date,episode_id" });
      if (error) throw error;
      result.episodeStats += rows.length;
    }
  }

  await db.from("sync_runs").insert({
    started_at: new Date().toISOString(),
    finished_at: new Date().toISOString(),
    status: "ok",
    created_count: result.episodeStats,
    updated_count: result.workStats,
    error_count: 0,
    note: `collect-annict-stats seasons=${targets.join(",")} date=${snapshotDate}`,
  });

  return result;
}
