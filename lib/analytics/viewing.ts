/**
 * 視聴分析（残留率・盛り上がり）のデータ層。
 * - 残留率: analytics_episode_stats の最新スナップショットから、1話の記録数=100%として話数推移を出す
 * - 盛り上がり: analytics_minute_heat / minute_reactions / peak_comments（ニコニコ実況由来）
 * 母数はあくまで「Annictに記録した人数」「ニコニコ実況のコメント数」であり視聴率ではない。
 */
import { getAdminClient } from "../supabase/admin.ts";
import type { ReactionCategory } from "./commentAnalysis.ts";

type Db = ReturnType<typeof getAdminClient>;

const chunk = <T,>(arr: T[], size: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
};

// ---------------------------------------------------------------- 残留率

export interface RetentionPoint {
  episodeNumber: number; // 表示用の話数（sort順の連番）
  numberText: string | null;
  records: number; // Annict記録数（累積）
  pct: number; // 1話=100 とした割合
}

export interface RetentionSeries {
  workId: string;
  title: string;
  posterUrl: string | null;
  popularity: number;
  points: RetentionPoint[];
}

export interface RetentionResult {
  snapshotDate: string | null;
  series: RetentionSeries[];
}

/**
 * 今期人気上位作品の「話数別 記録数カーブ」。
 * 直近に放送されたばかりの話は記録が伸び途中で誤解を招くため、
 * スナップショット時点で放送から4日未満の話は除外する。
 */
export async function getRetentionSeries(limit = 8): Promise<RetentionResult> {
  const db = getAdminClient();

  const { data: latest } = await db
    .from("analytics_episode_stats")
    .select("snapshot_date")
    .order("snapshot_date", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!latest) return { snapshotDate: null, series: [] };
  const snapshotDate: string = latest.snapshot_date;

  // 最新スナップショットの全行（episodes/works付き）
  const rows: any[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db
      .from("analytics_episode_stats")
      .select(
        "episode_id, work_id, records_count, episodes!inner(sort, number, number_text), works!inner(title, poster_url, key_visual_url, popularity)",
      )
      .eq("snapshot_date", snapshotDate)
      .range(from, from + 999);
    if (error) throw error;
    rows.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  if (rows.length === 0) return { snapshotDate, series: [] };

  // 各話の本放送日時（伸び途中の直近話を除くため）
  const episodeIds = rows.map((r) => r.episode_id);
  const firstAir = new Map<string, number>();
  for (const ids of chunk(episodeIds, 200)) {
    const { data } = await db
      .from("programs")
      .select("episode_id, start_at")
      .in("episode_id", ids)
      .eq("is_rebroadcast", false);
    for (const p of data ?? []) {
      const t = new Date(p.start_at).getTime();
      const cur = firstAir.get(p.episode_id);
      if (cur == null || t < cur) firstAir.set(p.episode_id, t);
    }
  }
  const cutoff = new Date(snapshotDate).getTime() - 4 * 24 * 3600 * 1000 + 9 * 3600 * 1000;

  // 作品ごとに集計
  const byWork = new Map<string, { meta: any; eps: any[] }>();
  for (const r of rows) {
    const air = firstAir.get(r.episode_id);
    if (air != null && air > cutoff) continue; // 放送4日未満は除外
    if (air == null) continue; // 放送日不明（未放送）は除外
    if (!byWork.has(r.work_id)) byWork.set(r.work_id, { meta: r.works, eps: [] });
    byWork.get(r.work_id)!.eps.push(r);
  }

  const series: RetentionSeries[] = [];
  for (const [workId, { meta, eps }] of byWork) {
    eps.sort((a, b) => (a.episodes.sort ?? 0) - (b.episodes.sort ?? 0));
    if (eps.length < 2) continue;
    const base = eps[0].records_count;
    if (base < 50) continue; // 母数が小さすぎる作品はノイズ
    series.push({
      workId,
      title: meta.title,
      posterUrl: meta.poster_url ?? meta.key_visual_url ?? null,
      popularity: meta.popularity ?? 0,
      points: eps.map((e, i) => ({
        episodeNumber: i + 1,
        numberText: e.episodes.number_text ?? (e.episodes.number != null ? `第${e.episodes.number}話` : null),
        records: e.records_count,
        pct: Math.round((e.records_count / base) * 1000) / 10,
      })),
    });
  }

  series.sort((a, b) => b.popularity - a.popularity);
  return { snapshotDate, series: series.slice(0, limit) };
}

// ---------------------------------------------------------------- 盛り上がり

export interface MinuteHeatPoint {
  minute: number;
  total: number;
  reactions: Partial<Record<ReactionCategory, number>>;
}

export interface PeakInfo {
  minute: number;
  comments: { text: string; count: number }[];
}

export interface ProgramHeat {
  programId: string;
  workId: string;
  workTitle: string;
  posterUrl: string | null;
  episodeLabel: string | null;
  channelName: string | null;
  startAt: string;
  totalComments: number;
  points: MinuteHeatPoint[];
  peaks: PeakInfo[];
}

/** 盛り上がった放送回ランキング（コメント数順、直近days日以内）。チャート描画用の分単位データ込み */
export async function getHotPrograms(limit = 6, days = 14): Promise<ProgramHeat[]> {
  const db = getAdminClient();
  const since = new Date(Date.now() - days * 24 * 3600 * 1000).toISOString();

  // 収集済みログをコメント数順に（候補は多めに取り、放送日で絞る）
  const { data: logs } = await db
    .from("analytics_collection_log")
    .select("program_id, comment_count")
    .eq("status", "collected")
    .gt("comment_count", 0)
    .order("comment_count", { ascending: false })
    .limit(200);
  if (!logs || logs.length === 0) return [];

  // 番組情報
  const progById = new Map<string, any>();
  for (const ids of chunk(logs.map((l) => l.program_id), 100)) {
    const { data } = await db
      .from("programs")
      .select(
        "id, work_id, start_at, count, episode_id, channels(name), works!inner(title, poster_url, key_visual_url), episodes(number_text, number, title)",
      )
      .in("id", ids)
      .gte("start_at", since);
    for (const p of data ?? []) progById.set(p.id, p);
  }

  const targets = logs.filter((l) => progById.has(l.program_id)).slice(0, limit);
  const out: ProgramHeat[] = [];
  for (const t of targets) {
    const p = progById.get(t.program_id)!;
    const heat = await loadProgramHeat(db, t.program_id);
    if (!heat) continue;
    const ep = p.episodes;
    const epLabel =
      ep?.number_text ?? (ep?.number != null ? `第${ep.number}話` : p.count != null ? `第${p.count}話` : null);
    out.push({
      programId: t.program_id,
      workId: p.work_id,
      workTitle: p.works.title,
      posterUrl: p.works.poster_url ?? p.works.key_visual_url ?? null,
      episodeLabel: epLabel,
      channelName: p.channels?.name ?? null,
      startAt: p.start_at,
      totalComments: t.comment_count,
      points: heat.points,
      peaks: heat.peaks,
    });
  }
  return out;
}

/** 1番組の分単位データ（heat + reactions + peaks）を読み込む */
async function loadProgramHeat(
  db: Db,
  programId: string,
): Promise<{ points: MinuteHeatPoint[]; peaks: PeakInfo[] } | null> {
  const [{ data: heat }, { data: reactions }, { data: peaks }] = await Promise.all([
    db
      .from("analytics_minute_heat")
      .select("minute_offset, comment_count")
      .eq("program_id", programId)
      .order("minute_offset"),
    db
      .from("analytics_minute_reactions")
      .select("minute_offset, category, count")
      .eq("program_id", programId),
    db
      .from("analytics_peak_comments")
      .select("minute_offset, comments")
      .eq("program_id", programId)
      .order("minute_offset"),
  ]);
  if (!heat || heat.length === 0) return null;

  const reactByMinute = new Map<number, Partial<Record<ReactionCategory, number>>>();
  for (const r of reactions ?? []) {
    if (!reactByMinute.has(r.minute_offset)) reactByMinute.set(r.minute_offset, {});
    reactByMinute.get(r.minute_offset)![r.category as ReactionCategory] = r.count;
  }

  // 0分〜最終分まで欠けを埋めた連続配列にする（棒グラフ用）
  const maxMinute = Math.min(
    Math.max(...heat.map((h) => h.minute_offset)),
    180, // 異常値ガード
  );
  const heatByMinute = new Map(heat.map((h) => [h.minute_offset, h.comment_count]));
  const points: MinuteHeatPoint[] = [];
  for (let m = 0; m <= maxMinute; m++) {
    points.push({ minute: m, total: heatByMinute.get(m) ?? 0, reactions: reactByMinute.get(m) ?? {} });
  }

  return {
    points,
    peaks: (peaks ?? []).map((p) => ({ minute: p.minute_offset, comments: p.comments ?? [] })),
  };
}

/** 特定作品の分析済み放送回（盛り上がりグラフ用）。最新の1件を返す */
export async function getWorkHeat(workId: string): Promise<ProgramHeat | null> {
  const db = getAdminClient();
  const { data: programs } = await db
    .from("programs")
    .select("id, start_at, count, episode_id, channels(name), episodes(number_text, number)")
    .eq("work_id", workId)
    .eq("is_rebroadcast", false)
    .order("start_at", { ascending: false })
    .limit(30);
  if (!programs || programs.length === 0) return null;

  const { data: logs } = await db
    .from("analytics_collection_log")
    .select("program_id, comment_count")
    .eq("status", "collected")
    .gt("comment_count", 0)
    .in(
      "program_id",
      programs.map((p) => p.id),
    );
  if (!logs || logs.length === 0) return null;

  // 最新の放送回を選ぶ
  const logByProgram = new Map(logs.map((l) => [l.program_id, l.comment_count]));
  const target = programs.find((p) => logByProgram.has(p.id));
  if (!target) return null;

  const heat = await loadProgramHeat(db, target.id);
  if (!heat) return null;

  const { data: work } = await db
    .from("works")
    .select("title, poster_url, key_visual_url")
    .eq("id", workId)
    .maybeSingle();
  const ep: any = target.episodes;
  return {
    programId: target.id,
    workId,
    workTitle: work?.title ?? "",
    posterUrl: work?.poster_url ?? work?.key_visual_url ?? null,
    episodeLabel:
      ep?.number_text ?? (ep?.number != null ? `第${ep.number}話` : target.count != null ? `第${target.count}話` : null),
    channelName: (target.channels as any)?.name ?? null,
    startAt: target.start_at,
    totalComments: logByProgram.get(target.id) ?? 0,
    points: heat.points,
    peaks: heat.peaks,
  };
}
