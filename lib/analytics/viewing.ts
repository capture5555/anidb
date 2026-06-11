/**
 * 視聴分析（残留率・盛り上がり）のデータ層。
 * - 残留率: analytics_episode_stats の最新スナップショットから、1話の記録数=100%として話数推移を出す
 * - 盛り上がり: analytics_minute_heat / minute_reactions / peak_comments（ニコニコ実況由来）
 * 母数はあくまで「Annictに記録した人数」「ニコニコ実況のコメント数」であり視聴率ではない。
 */
import { getAdminClient } from "../supabase/admin.ts";
import type { ReactionCategory } from "./commentAnalysis.ts";
import { memoizeTTL } from "../cache.ts";
import { fromSnapshotOrLive } from "./snapshots.ts";
import { getCollectedLogs } from "./collectedLogs.ts";

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
export async function getRetentionSeriesLive(limit = 8): Promise<RetentionResult> {
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

/** Annict 記録数カーブの LIVE 計算（limit 単位で30分メモ化）。 */
const getRetentionSeriesMemo = memoizeTTL(
  getRetentionSeriesLive,
  (limit = 8) => `retention:${limit}`,
  1800000,
);

/**
 * 今期人気上位作品の「話数別 記録数カーブ」。エクスポート名・挙動は従来どおり。
 * デフォルト引数（limit=8, ページが使う呼び出し）のときだけ事前計算スナップショット
 * ("annict_retention") を読み、無ければ LIVE 計算へフォールバック。
 * 非デフォルト引数のときは LIVE 計算する。
 */
export function getRetentionSeries(limit = 8): Promise<RetentionResult> {
  if (limit !== 8) return getRetentionSeriesMemo(limit);
  return fromSnapshotOrLive("annict_retention", () => getRetentionSeriesMemo(limit));
}

/**
 * 実況コメント数ベースの「話数別カーブ」。
 * 同じ話が複数チャンネルで収集されている場合は最大コメント数のチャンネルを代表にする。
 */
export async function getJikkyoRetentionSeriesLive(limit = 8): Promise<RetentionResult> {
  const db = getAdminClient();

  // 収集済みログを共有メモ化ヘルパーから取得（同一リクエスト内で他の live 関数と共有）
  const allLogs = await getCollectedLogs();
  if (allLogs.length === 0) return { snapshotDate: null, series: [] };
  const countByProgram = new Map(allLogs.map((l) => [l.program_id, l.comment_count]));

  // 番組→作品/話数
  const progs: any[] = [];
  for (const ids of chunk([...countByProgram.keys()], 150)) {
    const { data } = await db
      .from("programs")
      .select(
        "id, work_id, episode_id, start_at, episodes(sort, number, number_text), works!inner(title, poster_url, key_visual_url, popularity)",
      )
      .in("id", ids)
      .eq("is_rebroadcast", false)
      .not("episode_id", "is", null);
    progs.push(...(data ?? []));
  }

  // 作品→話数→代表コメント数（最大チャンネル）
  const byWork = new Map<string, { meta: any; eps: Map<string, { sort: number; label: string | null; count: number }> }>();
  for (const p of progs) {
    const c = countByProgram.get(p.id) ?? 0;
    if (!byWork.has(p.work_id)) byWork.set(p.work_id, { meta: p.works, eps: new Map() });
    const eps = byWork.get(p.work_id)!.eps;
    const cur = eps.get(p.episode_id);
    const label =
      p.episodes?.number_text ?? (p.episodes?.number != null ? `第${p.episodes.number}話` : null);
    if (!cur || c > cur.count) {
      eps.set(p.episode_id, { sort: p.episodes?.sort ?? 0, label, count: c });
    }
  }

  const series: RetentionSeries[] = [];
  for (const [workId, { meta, eps }] of byWork) {
    const sorted = [...eps.values()].sort((a, b) => a.sort - b.sort);
    if (sorted.length < 2) continue;
    const base = sorted[0].count;
    if (base < 100) continue; // 母数が小さすぎる作品はノイズ
    series.push({
      workId,
      title: meta.title,
      posterUrl: meta.poster_url ?? meta.key_visual_url ?? null,
      popularity: meta.popularity ?? 0,
      points: sorted.map((e, i) => ({
        episodeNumber: i + 1,
        numberText: e.label,
        records: e.count,
        pct: Math.round((e.count / base) * 1000) / 10,
      })),
    });
  }

  series.sort((a, b) => b.popularity - a.popularity);
  return { snapshotDate: null, series: series.slice(0, limit) };
}

/** 実況コメント数カーブの LIVE 計算（limit 単位で30分メモ化）。 */
const getJikkyoRetentionSeriesMemo = memoizeTTL(
  getJikkyoRetentionSeriesLive,
  (limit = 8) => `jikkyo:${limit}`,
  1800000,
);

/**
 * 実況コメント数ベースの「話数別カーブ」。エクスポート名・挙動は従来どおり。
 * デフォルト引数（limit=8）のときだけ事前計算スナップショット("jikkyo_retention")を読み、
 * 無ければ LIVE 計算へフォールバック。非デフォルト引数のときは LIVE 計算する。
 */
export function getJikkyoRetentionSeries(limit = 8): Promise<RetentionResult> {
  if (limit !== 8) return getJikkyoRetentionSeriesMemo(limit);
  return fromSnapshotOrLive("jikkyo_retention", () => getJikkyoRetentionSeriesMemo(limit));
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
export async function getHotProgramsLive(limit = 6, days = 14): Promise<ProgramHeat[]> {
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
  // 分単位データの読み込みは番組ごとに独立なので並列化（従来は逐次awaitで遅かった）。
  const heats = await Promise.all(targets.map((t) => loadProgramHeat(db, t.program_id)));
  const out: ProgramHeat[] = [];
  targets.forEach((t, i) => {
    const heat = heats[i];
    if (!heat) return;
    const p = progById.get(t.program_id)!;
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
  });
  return out;
}

/** limit/days 単位で30分メモ化した LIVE 計算。 */
const getHotProgramsMemo = memoizeTTL(
  getHotProgramsLive,
  (limit = 6, days = 14) => `hot:${limit}:${days}`,
  30 * 60 * 1000,
);

/**
 * 「いま熱い放送回」。ページが使うデフォルト引数(limit=6, days=14)のときだけ
 * 事前計算スナップショット("hot_programs")を読み、無ければ LIVE フォールバック。
 */
export function getHotPrograms(limit = 6, days = 14): Promise<ProgramHeat[]> {
  if (limit !== 6 || days !== 14) return getHotProgramsMemo(limit, days);
  return fromSnapshotOrLive("hot_programs", () => getHotProgramsMemo(limit, days));
}

/** 1番組の分単位データ（heat + reactions + peaks）を読み込む */
async function loadProgramHeat(
  db: Db,
  programId: string,
): Promise<{ points: MinuteHeatPoint[]; peaks: PeakInfo[]; representativeComments: RepresentativeComment[] } | null> {
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

  // ピーク分の代表コメント文字列（DB は string[] で保存されている）
  // コメント数の多い分を上位3分、各分で最大5件に絞る
  const peakRows = (peaks ?? []).filter((p) => Array.isArray(p.comments) && p.comments.length > 0);
  const heatByMinuteForPeak = new Map(heat.map((h) => [h.minute_offset, h.comment_count]));
  const topPeakRows = peakRows
    .slice()
    .sort((a, b) => (heatByMinuteForPeak.get(b.minute_offset) ?? 0) - (heatByMinuteForPeak.get(a.minute_offset) ?? 0))
    .slice(0, 3);

  return {
    points,
    peaks: (peaks ?? []).map((p) => ({ minute: p.minute_offset, comments: p.comments ?? [] })),
    representativeComments: topPeakRows.map((p) => ({
      minuteOffset: p.minute_offset,
      comments: (p.comments as unknown as string[]).slice(0, 5),
    })),
  };
}

// ---------------------------------------------------------------- リアクション構成比

export interface ReactionRatioWork {
  workId: string;
  title: string;
  posterUrl: string | null;
  totalComments: number;
  /** カテゴリ → 構成比%（コメント総数に対する割合） */
  ratios: Partial<Record<ReactionCategory, number>>;
}

/** 作品ごとのリアクション構成比（笑い率・感動率・作画注目率ランキング用）の LIVE 計算。 */
export async function getReactionRatiosLive(minComments = 1000): Promise<ReactionRatioWork[]> {
  const db = getAdminClient();

  // 収集済み番組の総コメント数（共有メモ化ヘルパーから取得）
  const allLogs = await getCollectedLogs();
  if (allLogs.length === 0) return [];
  const countByProgram = new Map(allLogs.map((l) => [l.program_id, l.comment_count]));

  // 番組→作品
  const workByProgram = new Map<string, string>();
  const workMeta = new Map<string, { title: string; posterUrl: string | null }>();
  for (const ids of chunk([...countByProgram.keys()], 150)) {
    const { data } = await db
      .from("programs")
      .select("id, work_id, works!inner(title, poster_url, key_visual_url)")
      .in("id", ids);
    for (const p of data ?? []) {
      workByProgram.set(p.id, p.work_id);
      if (!workMeta.has(p.work_id)) {
        const w: any = p.works;
        workMeta.set(p.work_id, { title: w.title, posterUrl: w.poster_url ?? w.key_visual_url ?? null });
      }
    }
  }

  // リアクション行を全部読んで作品単位に集計
  const reactByWork = new Map<string, Partial<Record<ReactionCategory, number>>>();
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await db
      .from("analytics_minute_reactions")
      .select("program_id, category, count")
      .range(offset, offset + 999);
    if (error) throw error;
    for (const r of data ?? []) {
      const workId = workByProgram.get(r.program_id);
      if (!workId) continue;
      if (!reactByWork.has(workId)) reactByWork.set(workId, {});
      const m = reactByWork.get(workId)!;
      m[r.category as ReactionCategory] = (m[r.category as ReactionCategory] ?? 0) + r.count;
    }
    if (!data || data.length < 1000) break;
  }

  // 作品ごとの総コメント数
  const totalByWork = new Map<string, number>();
  for (const [programId, count] of countByProgram) {
    const workId = workByProgram.get(programId);
    if (!workId) continue;
    totalByWork.set(workId, (totalByWork.get(workId) ?? 0) + count);
  }

  const out: ReactionRatioWork[] = [];
  for (const [workId, total] of totalByWork) {
    if (total < minComments) continue;
    const meta = workMeta.get(workId);
    if (!meta) continue;
    const sums = reactByWork.get(workId) ?? {};
    const ratios: Partial<Record<ReactionCategory, number>> = {};
    for (const [cat, sum] of Object.entries(sums)) {
      ratios[cat as ReactionCategory] = Math.round(((sum as number) / total) * 1000) / 10;
    }
    out.push({ workId, title: meta.title, posterUrl: meta.posterUrl, totalComments: total, ratios });
  }
  return out;
}

/** リアクション構成比の LIVE 計算（minComments 単位で30分メモ化）。 */
const getReactionRatiosMemo = memoizeTTL(
  getReactionRatiosLive,
  (minComments = 1000) => `reactratio:${minComments}`,
  1800000,
);

/**
 * 作品ごとのリアクション構成比。エクスポート名・挙動は従来どおり。
 * デフォルト引数（minComments=1000）のときだけ事前計算スナップショット("reaction_ratios")を読み、
 * 無ければ LIVE 計算へフォールバック。非デフォルト引数のときは LIVE 計算する。
 */
export function getReactionRatios(minComments = 1000): Promise<ReactionRatioWork[]> {
  if (minComments !== 1000) return getReactionRatiosMemo(minComments);
  return fromSnapshotOrLive("reaction_ratios", () => getReactionRatiosMemo(minComments));
}

// ---------------------------------------------------------------- 瞬間最大風速

export interface PeakMoment {
  programId: string;
  workId: string;
  workTitle: string;
  posterUrl: string | null;
  episodeLabel: string | null;
  channelName: string | null;
  startAt: string;
  minute: number;
  maxPerMinute: number;
  topComments: { text: string; count: number }[];
}

/** 瞬間最大風速ランキング（1分あたり最大コメント数）の LIVE 計算。 */
export async function getPeakMomentsLive(limit = 10): Promise<PeakMoment[]> {
  const db = getAdminClient();

  // idx_amh_count (comment_count DESC) を利用してテーブル先頭の高コメント行だけを読む。
  // 上位10作品のピーク瞬間は必ず全番組×全分の中でコメント数上位に属するため、
  // 上位2000行（上位limitの数十倍）を降順で取れば per-program 最大値が確実に含まれる。
  // これにより全行ページングが不要になり、テーブルが成長しても定常O(2000)で済む。
  const { data: topRows, error } = await db
    .from("analytics_minute_heat")
    .select("program_id, minute_offset, comment_count")
    .order("comment_count", { ascending: false })
    .limit(2000);
  if (error) throw error;

  // 取得済みの行から番組ごとの最大分を抽出（降順のため最初に出た行が最大値）
  const maxByProgram = new Map<string, { minute: number; count: number }>();
  for (const r of topRows ?? []) {
    if (!maxByProgram.has(r.program_id)) {
      maxByProgram.set(r.program_id, { minute: r.minute_offset, count: r.comment_count });
    }
  }
  if (maxByProgram.size === 0) return [];

  const top = [...maxByProgram.entries()]
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, limit * 2); // 番組情報が引けない分の余裕

  const out: PeakMoment[] = [];
  for (const ids of chunk(top.map(([id]) => id), 100)) {
    const { data } = await db
      .from("programs")
      .select(
        "id, work_id, start_at, count, channels(name), works!inner(title, poster_url, key_visual_url), episodes(number_text, number)",
      )
      .in("id", ids);
    for (const p of data ?? []) {
      const m = maxByProgram.get(p.id)!;
      const ep: any = p.episodes;
      const w: any = p.works;
      out.push({
        programId: p.id,
        workId: p.work_id,
        workTitle: w.title,
        posterUrl: w.poster_url ?? w.key_visual_url ?? null,
        episodeLabel:
          ep?.number_text ?? (ep?.number != null ? `第${ep.number}話` : p.count != null ? `第${p.count}話` : null),
        channelName: (p.channels as any)?.name ?? null,
        startAt: p.start_at,
        minute: m.minute,
        maxPerMinute: m.count,
        topComments: [],
      });
    }
  }
  out.sort((a, b) => b.maxPerMinute - a.maxPerMinute);
  const ranked = out.slice(0, limit);

  // ピーク分の代表コメント — 1クエリでまとめて取得（N+1 回避）
  const peakRows: { program_id: string; minute_offset: number; comments: any[] }[] = [];
  for (const ids of chunk(ranked.map((r) => r.programId), 100)) {
    const { data } = await db
      .from("analytics_peak_comments")
      .select("program_id, minute_offset, comments")
      .in("program_id", ids);
    peakRows.push(...(data ?? []));
  }
  // program_id + minute_offset → comments のマップを作り、ranked に適用
  const peakMap = new Map<string, any[]>();
  for (const row of peakRows) peakMap.set(`${row.program_id}:${row.minute_offset}`, row.comments ?? []);
  for (const r of ranked) {
    r.topComments = (peakMap.get(`${r.programId}:${r.minute}`) ?? []).slice(0, 3);
  }
  return ranked;
}

/** 瞬間最大風速ランキングの LIVE 計算（limit 単位で30分メモ化）。 */
const getPeakMomentsMemo = memoizeTTL(
  getPeakMomentsLive,
  (limit = 10) => `peak:${limit}`,
  1800000,
);

/**
 * 瞬間最大風速ランキング。エクスポート名・挙動は従来どおり。
 * デフォルト引数（limit=10）のときだけ事前計算スナップショット("peak_moments")を読み、
 * 無ければ LIVE 計算へフォールバック。非デフォルト引数のときは LIVE 計算する。
 */
export function getPeakMoments(limit = 10): Promise<PeakMoment[]> {
  if (limit !== 10) return getPeakMomentsMemo(limit);
  return fromSnapshotOrLive("peak_moments", () => getPeakMomentsMemo(limit));
}

// ---------------------------------------------------------------- 作品別分析

export interface RepresentativeComment {
  minuteOffset: number;
  comments: string[];
}

export interface EpisodeHeat {
  programId: string;
  episodeId: string | null;
  episodeLabel: string;
  channelName: string | null;
  startAt: string;
  totalComments: number;
  points: MinuteHeatPoint[];
  peaks: PeakInfo[];
  /** ピーク分の代表コメント（analytics_peak_comments 由来の文字列配列）。無い場合は空配列。 */
  representativeComments: RepresentativeComment[];
}

export interface WorkAnalysis {
  workId: string;
  title: string;
  posterUrl: string | null;
  /** 話数別（実況コメント数ベース、各話の代表チャンネル） */
  episodes: EpisodeHeat[];
  /** Annict記録数の話数別カーブ（最新スナップショット） */
  annictPoints: RetentionPoint[];
  /** 話数別の満足度%（Annict satisfaction_rate、無い話はnull） */
  satisfactionPoints: { episodeNumber: number; numberText: string | null; rate: number }[];
}

/** 作品の全収集済み放送回の分析データ（全話の盛り上がりグラフ＋話数トレンド用）の LIVE 計算。
 * 話数ごとに programs + 分単位の minute_heat/reactions/peaks を引くため重い。
 * compute-snapshots からはこの素の関数を呼ぶ。 */
export async function getWorkAnalysisLive(workId: string): Promise<WorkAnalysis | null> {
  const db = getAdminClient();

  const { data: work } = await db
    .from("works")
    .select("title, poster_url, key_visual_url")
    .eq("id", workId)
    .maybeSingle();
  if (!work) return null;

  const { data: programs } = await db
    .from("programs")
    .select("id, episode_id, start_at, count, channels(name), episodes(sort, number, number_text)")
    .eq("work_id", workId)
    .eq("is_rebroadcast", false)
    .order("start_at")
    .limit(200);

  const result: WorkAnalysis = {
    workId,
    title: work.title,
    posterUrl: work.poster_url ?? work.key_visual_url ?? null,
    episodes: [],
    annictPoints: [],
    satisfactionPoints: [],
  };

  if (programs && programs.length > 0) {
    const { data: logs } = await db
      .from("analytics_collection_log")
      .select("program_id, comment_count")
      .eq("status", "collected")
      .gt("comment_count", 0)
      .in(
        "program_id",
        programs.map((p) => p.id),
      );
    const countByProgram = new Map((logs ?? []).map((l) => [l.program_id, l.comment_count]));

    // 話数ごとに代表番組（最大コメント数のチャンネル）を選ぶ
    const repByEpisode = new Map<string, any>();
    for (const p of programs) {
      if (!countByProgram.has(p.id)) continue;
      const key = p.episode_id ?? p.id;
      const cur = repByEpisode.get(key);
      if (!cur || (countByProgram.get(p.id) ?? 0) > (countByProgram.get(cur.id) ?? 0)) {
        repByEpisode.set(key, p);
      }
    }

    const reps = [...repByEpisode.values()].sort(
      (a, b) =>
        (a.episodes?.sort ?? 9999) - (b.episodes?.sort ?? 9999) ||
        new Date(a.start_at).getTime() - new Date(b.start_at).getTime(),
    );

    // 各話のヒートを並列ロード
    const heats = await Promise.all(reps.map((p) => loadProgramHeat(db, p.id)));
    reps.forEach((p, i) => {
      const heat = heats[i];
      if (!heat) return;
      const ep: any = p.episodes;
      result.episodes.push({
        programId: p.id,
        episodeId: p.episode_id,
        episodeLabel:
          ep?.number_text ??
          (ep?.number != null ? `第${ep.number}話` : p.count != null ? `第${p.count}話` : "放送回"),
        channelName: (p.channels as any)?.name ?? null,
        startAt: p.start_at,
        totalComments: countByProgram.get(p.id) ?? 0,
        points: heat.points,
        peaks: heat.peaks,
        representativeComments: heat.representativeComments,
      });
    });
  }

  // Annict記録数（最新スナップショット）
  const { data: latest } = await db
    .from("analytics_episode_stats")
    .select("snapshot_date")
    .eq("work_id", workId)
    .order("snapshot_date", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (latest) {
    const { data: stats } = await db
      .from("analytics_episode_stats")
      .select("records_count, satisfaction_rate, episodes!inner(sort, number, number_text)")
      .eq("work_id", workId)
      .eq("snapshot_date", latest.snapshot_date);
    const sorted = (stats ?? [])
      .map((s: any) => s)
      .sort((a: any, b: any) => (a.episodes.sort ?? 0) - (b.episodes.sort ?? 0))
      .filter((s: any) => s.records_count > 0);
    if (sorted.length >= 2) {
      const base = sorted[0].records_count;
      const label = (s: any) =>
        s.episodes.number_text ?? (s.episodes.number != null ? `第${s.episodes.number}話` : null);
      result.annictPoints = sorted.map((s: any, i: number) => ({
        episodeNumber: i + 1,
        numberText: label(s),
        records: s.records_count,
        pct: Math.round((s.records_count / base) * 1000) / 10,
      }));
      result.satisfactionPoints = sorted
        .map((s: any, i: number) => ({
          episodeNumber: i + 1,
          numberText: label(s),
          rate: s.satisfaction_rate != null ? Math.round(Number(s.satisfaction_rate) * 10) / 10 : NaN,
        }))
        .filter((p: any) => !Number.isNaN(p.rate));
    }
  }

  if (result.episodes.length === 0 && result.annictPoints.length === 0) return null;
  return result;
}

/**
 * 作品の全収集済み放送回の分析データ。エクスポート名・シグネチャ・戻り値は従来どおり。
 * 今期放送中TV作品は compute-snapshots が事前計算したスナップショット("work_analysis:{id}")を読み、
 * 無ければ LIVE 計算へフォールバック（防御的・クラッシュしない）。
 *
 * workId 単位で 15 分メモ化し、スナップショット読み取り（DB往復）と LIVE フォールバックの
 * 双方を覆う。今期作品のページレンダリングごとの DB ヒットを避けるのが狙い。
 * 現在30分おきに更新される今期作品のスナップショットに対し、最大15分の追加滞留が生じるが許容範囲。
 */
export const getWorkAnalysis = memoizeTTL(
  (workId: string): Promise<WorkAnalysis | null> =>
    fromSnapshotOrLive(`work_analysis:${workId}`, () => getWorkAnalysisLive(workId)),
  (workId: string) => `work_analysis:${workId}`,
  900000,
);

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
