import { getAdminClient } from "../supabase/admin.ts";
import { fetchKakolog } from "../adapters/jikkyo.ts";
import { analyzeProgram, type ProgramAnalysis } from "../analytics/commentAnalysis.ts";

/**
 * ニコニコ実況の過去ログを収集し、生ログ保存＋分単位の分析結果を保存する。
 * - 対象: end_at が「26時間前〜45分前」の本放送（過去ログAPIへの反映バッファとして45分待つ）
 * - 冪等: analytics_collection_log(program_id, source) が収集済みゲート。
 *   no_channel（実況チャンネルの無い局）も記録して再試行させない。
 * - 自動リトライ: 過去ログAPIへの反映が遅れて空取得(no_comments)・エラー(error)になった回は、
 *   放送終了から AUTO_RETRY_HOURS(=48h) 以内なら毎時の収集で再挑戦する（反映され次第コメントを拾う）。
 *   48hを過ぎたら凍結（恒久的に no_comments/error として確定）。
 *   collected / no_channel は常に done（再収集しない＝冪等性を保つ）。
 *   JIKKYO_RETRY_FAILED=1 のときは経過時間に関係なく error / no_comments を再収集（手動バックフィル用）。
 */

const SOURCE = "nicojk";
// JIKKYO_LOOKBACK_HOURS で過去ログのさかのぼり時間を上書きできる（バックフィル用）
const LOOKBACK_HOURS = Number(process.env.JIKKYO_LOOKBACK_HOURS) || 26;
const MIN_AGE_MINUTES = 45;
// 空取得/エラーの自動リトライ窓。放送終了からこの時間内なら毎時再挑戦し、過ぎたら凍結。
const AUTO_RETRY_HOURS = Number(process.env.JIKKYO_AUTO_RETRY_HOURS) || 48;
// 実況収集の対象外チャンネル（jikkyo_id）。AT-X(jk333)は有料CSで実況が少なく
// 代表チャンネル選定のノイズになるため除外（DB側でも 0009 で jikkyo_id を外している）。
const EXCLUDED_JIKKYO_IDS = new Set<string>(["jk333"]);
// JIKKYO_RETRY_FAILED=1 のとき、過去ログ未反映で空取得(no_comments)・エラー(error)になった回も
// 再収集対象に戻す（バックフィル用）。collected / no_channel は引き続きスキップ。
const RETRY_FAILED = /^(1|true|yes|on)$/i.test(process.env.JIKKYO_RETRY_FAILED ?? "");
const RETRYABLE_STATUS = new Set(["error", "no_comments"]);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const chunk = <T,>(arr: T[], size: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
};

export interface CollectJikkyoResult {
  candidates: number;
  collected: number;
  noChannel: number;
  noComments: number;
  errors: number;
}

type Db = ReturnType<typeof getAdminClient>;

/** 分析結果を保存する（delete-then-insert。reanalyze-comments からも使う） */
export async function storeProgramAnalysis(
  db: Db,
  programId: string,
  analysis: ProgramAnalysis,
): Promise<void> {
  await db.from("analytics_minute_heat").delete().eq("program_id", programId).eq("source", SOURCE);
  await db.from("analytics_minute_reactions").delete().eq("program_id", programId);
  await db.from("analytics_peak_comments").delete().eq("program_id", programId);

  if (analysis.heat.length > 0) {
    const { error } = await db.from("analytics_minute_heat").insert(
      analysis.heat.map((h) => ({
        program_id: programId,
        source: SOURCE,
        minute_offset: h.minute,
        comment_count: h.count,
      })),
    );
    if (error) throw error;
  }
  if (analysis.reactions.length > 0) {
    const { error } = await db.from("analytics_minute_reactions").insert(
      analysis.reactions.map((r) => ({
        program_id: programId,
        minute_offset: r.minute,
        category: r.category,
        count: r.count,
      })),
    );
    if (error) throw error;
  }
  if (analysis.peaks.length > 0) {
    const { error } = await db.from("analytics_peak_comments").insert(
      analysis.peaks.map((p) => ({
        program_id: programId,
        minute_offset: p.minute,
        comments: p.top,
      })),
    );
    if (error) throw error;
  }
}

async function logCollection(
  db: Db,
  programId: string,
  status: string,
  commentCount: number,
  note?: string,
): Promise<void> {
  await db
    .from("analytics_collection_log")
    .upsert(
      {
        program_id: programId,
        source: SOURCE,
        status,
        comment_count: commentCount,
        note: note ?? null,
        collected_at: new Date().toISOString(),
      },
      { onConflict: "program_id,source" },
    );
}

export async function collectJikkyo(): Promise<CollectJikkyoResult> {
  const db = getAdminClient();
  const now = Date.now();
  const from = new Date(now - LOOKBACK_HOURS * 3600 * 1000).toISOString();
  const to = new Date(now - MIN_AGE_MINUTES * 60 * 1000).toISOString();

  // 1000行ずつページングして窓内の全番組を取得（supabaseの既定上限対策）
  const programs: any[] = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await db
      .from("programs")
      .select("id, start_at, end_at, channels(jikkyo_id, name)")
      .gte("end_at", from)
      .lte("end_at", to)
      .eq("is_rebroadcast", false)
      .order("end_at")
      .range(offset, offset + 999);
    if (error) throw error;
    programs.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }

  // 番組ごとの end_at（自動リトライの経過時間判定に使う）
  const endAtByProgram = new Map<string, number>();
  for (const p of programs ?? []) {
    const t = new Date(p.end_at ?? p.start_at).getTime();
    if (!Number.isNaN(t)) endAtByProgram.set(p.id, t);
  }
  const autoRetryCutoff = now - AUTO_RETRY_HOURS * 3600 * 1000;

  // 収集済み（no_channel 等も含む）を done に入れて除外する。
  // ただし error / no_comments は「再収集対象」に戻す（done に入れない）ことがある:
  //   - RETRY_FAILED 時: 経過時間に関係なく全て再収集（手動バックフィル）
  //   - 通常時: 放送終了が AUTO_RETRY_HOURS 以内（過去ログ反映待ちの可能性）なら再収集
  // collected / no_channel は常に done（冪等性を保ち、二重収集しない）。
  const done = new Set<string>();
  for (const ids of chunk((programs ?? []).map((p) => p.id), 200)) {
    const { data } = await db
      .from("analytics_collection_log")
      .select("program_id, status")
      .eq("source", SOURCE)
      .in("program_id", ids);
    for (const row of data ?? []) {
      if (RETRYABLE_STATUS.has(row.status)) {
        const endAt = endAtByProgram.get(row.program_id) ?? 0;
        const recent = endAt >= autoRetryCutoff;
        if (RETRY_FAILED || recent) continue; // 再収集対象（done に入れない）
      }
      done.add(row.program_id);
    }
  }
  const targets = (programs ?? []).filter((p) => !done.has(p.id));

  const result: CollectJikkyoResult = {
    candidates: targets.length,
    collected: 0,
    noChannel: 0,
    noComments: 0,
    errors: 0,
  };

  for (const p of targets) {
    const channel: any = p.channels;
    const jkId: string | null = channel?.jikkyo_id ?? null;
    if (!jkId || EXCLUDED_JIKKYO_IDS.has(jkId)) {
      await logCollection(db, p.id, "no_channel", 0, channel?.name ?? "channel unknown");
      result.noChannel++;
      continue;
    }

    const startUnix = Math.floor(new Date(p.start_at).getTime() / 1000);
    const endUnix = Math.floor(new Date(p.end_at ?? p.start_at).getTime() / 1000) || startUnix + 1800;

    try {
      const comments = await fetchKakolog(jkId, startUnix, endUnix);
      if (comments.length === 0) {
        await logCollection(db, p.id, "no_comments", 0);
        result.noComments++;
      } else {
        // 生ログ（保険＋再分析用）: delete-then-insert
        await db.from("analytics_jikkyo_comments").delete().eq("program_id", p.id);
        for (const rows of chunk(comments, 1000)) {
          const { error: insErr } = await db.from("analytics_jikkyo_comments").insert(
            rows.map((c) => ({
              program_id: p.id,
              jikkyo_id: jkId,
              posted_at: new Date(c.date * 1000).toISOString(),
              content: c.content,
            })),
          );
          if (insErr) throw insErr;
        }

        const analysis = analyzeProgram(comments, startUnix);
        await storeProgramAnalysis(db, p.id, analysis);
        await logCollection(db, p.id, "collected", comments.length);
        result.collected++;
      }
    } catch (e) {
      console.error(`[collectJikkyo] program=${p.id} jk=${jkId}`, e);
      await logCollection(db, p.id, "error", 0, String(e).slice(0, 500));
      result.errors++;
    }

    await sleep(1000); // 個人運営APIへの配慮
  }

  await db.from("sync_runs").insert({
    started_at: new Date().toISOString(),
    finished_at: new Date().toISOString(),
    status: result.errors === 0 ? "ok" : "partial",
    created_count: result.collected,
    updated_count: result.noComments,
    error_count: result.errors,
    note: `collect-jikkyo candidates=${result.candidates} no_channel=${result.noChannel}`,
  });

  return result;
}
