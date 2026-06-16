/**
 * 収集状況（ニコニコ実況 過去ログ収集の健全性）のデータ層。
 * - カバレッジ: 直近の本放送のうち、実況チャンネルがある番組をどれだけ収集できているか
 * - 収集ジョブ: collect-jikkyo の sync_runs 履歴（毎時動いているかの確認）
 * - 取りこぼし: 収集すべきだがまだ取れていない番組の一覧（自動リトライ対象）
 *
 * すべて防御的に実装する（try/catch → 空を返す）。このページはダッシュボードであり、
 * 集計の失敗や一時的なDBエラーで 500 にしてはならない。
 */
import { getAdminClient } from "../supabase/admin.ts";

type Db = ReturnType<typeof getAdminClient>;

const SOURCE = "nicojk";
// 収集の politeness バッファ。end_at がこの時間より新しい番組はまだ収集対象になっていない。
const MIN_AGE_MINUTES = 45;
const COVERAGE_DAYS = 7;

const chunk = <T,>(arr: T[], size: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
};

// ---------------------------------------------------------------- 共通

/** 実況チャンネルがある本放送番組（直近COVERAGE_DAYS〜MIN_AGE_MINUTES前）をページングで全件取得。 */
async function fetchEligiblePrograms(db: Db): Promise<any[]> {
  const now = Date.now();
  const from = new Date(now - COVERAGE_DAYS * 24 * 3600 * 1000).toISOString();
  const to = new Date(now - MIN_AGE_MINUTES * 60 * 1000).toISOString();

  const programs: any[] = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await db
      .from("programs")
      .select(
        "id, start_at, end_at, count, channels(jikkyo_id, name), works(title), episodes(number, number_text)",
      )
      .gte("end_at", from)
      .lte("end_at", to)
      .eq("is_rebroadcast", false)
      .order("start_at", { ascending: false })
      .range(offset, offset + 999);
    if (error) throw error;
    programs.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  // 実況チャンネル(jikkyo_id)を持つものだけ対象（持たない局は収集対象外＝カバレッジの母数に含めない）
  return programs.filter((p) => (p.channels as any)?.jikkyo_id);
}

/** 番組IDの収集ログ status を引く（program_id → status のマップ）。 */
async function fetchLogStatus(db: Db, programIds: string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  for (const ids of chunk(programIds, 200)) {
    const { data } = await db
      .from("analytics_collection_log")
      .select("program_id, status")
      .eq("source", SOURCE)
      .in("program_id", ids);
    for (const row of data ?? []) map.set(row.program_id, row.status);
  }
  return map;
}

// ---------------------------------------------------------------- カバレッジ

export interface CoverageStats {
  total: number;
  collected: number;
  noComments: number;
  error: number;
  pending: number; // ログ行なし（未収集）
  collectedPct: number; // collected / total * 100
}

/**
 * 直近の収集カバレッジ。実況チャンネルのある本放送のうち、
 * collected / no_comments / error / 未収集 の内訳と収集率を返す。
 */
export async function getCoverageStats(): Promise<CoverageStats> {
  const empty: CoverageStats = {
    total: 0,
    collected: 0,
    noComments: 0,
    error: 0,
    pending: 0,
    collectedPct: 0,
  };
  try {
    const db = getAdminClient();
    const programs = await fetchEligiblePrograms(db);
    if (programs.length === 0) return empty;

    const statusByProgram = await fetchLogStatus(
      db,
      programs.map((p) => p.id),
    );

    let collected = 0;
    let noComments = 0;
    let error = 0;
    let pending = 0;
    for (const p of programs) {
      const status = statusByProgram.get(p.id);
      if (status === "collected") collected++;
      else if (status === "no_comments") noComments++;
      else if (status === "error") error++;
      else pending++; // 未収集（ログ無し）または no_channel など想定外は未収集扱い
    }
    const total = collected + noComments + error + pending;
    return {
      total,
      collected,
      noComments,
      error,
      pending,
      collectedPct: total > 0 ? Math.round((collected / total) * 1000) / 10 : 0,
    };
  } catch {
    return empty;
  }
}

// ---------------------------------------------------------------- 収集ジョブ履歴

export interface CollectionJob {
  id: string;
  status: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  collected: number; // created_count
  noComments: number; // updated_count
  errors: number; // error_count
  note: string | null;
}

/** 直近の collect-jikkyo ジョブ（sync_runs）。毎時動いているかの確認用。 */
export async function getRecentJobs(limit = 12): Promise<CollectionJob[]> {
  try {
    const db = getAdminClient();
    const { data, error } = await db
      .from("sync_runs")
      .select("id, status, started_at, finished_at, created_count, updated_count, error_count, note")
      .like("note", "collect-jikkyo%")
      .order("finished_at", { ascending: false, nullsFirst: false })
      .limit(limit);
    if (error) return [];
    return (data ?? []).map((r) => ({
      id: r.id,
      status: r.status ?? null,
      startedAt: r.started_at ?? null,
      finishedAt: r.finished_at ?? null,
      collected: r.created_count ?? 0,
      noComments: r.updated_count ?? 0,
      errors: r.error_count ?? 0,
      note: r.note ?? null,
    }));
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------- 全アクション実行履歴

export interface SyncRunRow {
  id: string;
  status: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  created: number;
  updated: number;
  errors: number;
  note: string | null;
  /** note 先頭から推定したジョブ種別ラベル */
  jobLabel: string;
}

/** note 先頭のジョブ識別子からUI用の日本語ラベルを推定する。 */
export function inferJobLabel(note: string | null): string {
  if (!note) return "不明";
  if (note.startsWith("collect-jikkyo")) return "実況コメント収集";
  if (note.startsWith("collect-annict-stats")) return "Annict視聴統計";
  if (note.startsWith("collect-x-buzz")) return "Xバズ収集";
  if (note.startsWith("enrich-posters")) return "ポスター補完";
  if (note.startsWith("enrich-popularity")) return "人気度更新";
  if (note.startsWith("enrich-scores")) return "スコア補完";
  if (note.startsWith("compute-snapshots")) return "スナップショット計算";
  if (note.startsWith("ingest")) return "番組・作品取込";
  return note.split(/\s/)[0] ?? "不明";
}

/** sync_runs を新しい順に最大 limit 件取得（全ジョブ種別）。 */
export async function getAllSyncRuns(limit = 30): Promise<SyncRunRow[]> {
  try {
    const db = getAdminClient();
    const { data, error } = await db
      .from("sync_runs")
      .select("id, status, started_at, finished_at, created_count, updated_count, error_count, note")
      .order("finished_at", { ascending: false, nullsFirst: false })
      .limit(limit);
    if (error) return [];
    return (data ?? []).map((r) => ({
      id: r.id,
      status: r.status ?? null,
      startedAt: r.started_at ?? null,
      finishedAt: r.finished_at ?? null,
      created: r.created_count ?? 0,
      updated: r.updated_count ?? 0,
      errors: r.error_count ?? 0,
      note: r.note ?? null,
      jobLabel: inferJobLabel(r.note ?? null),
    }));
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------- 取りこぼし一覧

export interface CollectionGap {
  programId: string;
  workTitle: string;
  episodeLabel: string | null;
  channelName: string | null;
  startAt: string;
  status: "error" | "no_comments" | "pending";
}

/**
 * 取りこぼし一覧。収集すべきだがまだ取れていない番組
 * （error / no_comments / 未収集）を新しい順に最大 limit 件。
 */
export async function getCollectionGaps(limit = 30): Promise<CollectionGap[]> {
  try {
    const db = getAdminClient();
    const programs = await fetchEligiblePrograms(db); // start_at 降順
    if (programs.length === 0) return [];

    const statusByProgram = await fetchLogStatus(
      db,
      programs.map((p) => p.id),
    );

    const gaps: CollectionGap[] = [];
    for (const p of programs) {
      const status = statusByProgram.get(p.id);
      let gapStatus: CollectionGap["status"] | null = null;
      if (status === "error") gapStatus = "error";
      else if (status === "no_comments") gapStatus = "no_comments";
      else if (status == null) gapStatus = "pending";
      if (!gapStatus) continue; // collected / no_channel 等はスキップ

      const work: any = p.works;
      const ep: any = p.episodes;
      gaps.push({
        programId: p.id,
        workTitle: work?.title ?? "（作品名不明）",
        episodeLabel:
          ep?.number_text ??
          (ep?.number != null ? `第${ep.number}話` : p.count != null ? `第${p.count}話` : null),
        channelName: (p.channels as any)?.name ?? null,
        startAt: p.start_at,
        status: gapStatus,
      });
      if (gaps.length >= limit) break;
    }
    return gaps;
  } catch {
    return [];
  }
}
