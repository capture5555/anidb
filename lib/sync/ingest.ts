import { getAdminClient } from "@/lib/supabase/admin";
import {
  fetchWorksBySeason,
  normalizeSeasonName,
  type AnnictWork,
} from "@/lib/adapters/annict";
import { fetchProgramsByTid, fetchTidByPid, type SyoboiProgram } from "@/lib/adapters/syoboi";
import type { WorkStatus } from "@/lib/types";

export interface IngestResult {
  works: number;
  episodes: number;
  programs: number;
  errors: number;
}

/** 放送状況を放送回の最初/最後と現在時刻から推定 */
function computeStatus(programDates: string[]): WorkStatus {
  if (programDates.length === 0) return "upcoming";
  const now = Date.now();
  const times = programDates.map((d) => new Date(d).getTime()).sort((a, b) => a - b);
  const first = times[0];
  const last = times[times.length - 1];
  if (now < first) return "upcoming";
  // 最終話放送+1日経過で終了扱い
  if (now > last + 86400000) return "finished";
  return "airing";
}

/**
 * シーズン取り込み。Annictの作品メタ + しょぼいの放送時刻を統合してDBへ。
 * docs/08 の ingest ジョブに相当。
 */
export async function ingestSeason(seasonSlug: string): Promise<IngestResult> {
  const db = getAdminClient();
  const result: IngestResult = { works: 0, episodes: 0, programs: 0, errors: 0 };

  const annictWorks = await fetchWorksBySeason(seasonSlug);

  for (const aw of annictWorks) {
    try {
      await ingestWork(db, aw, result);
      result.works++;
    } catch (e) {
      console.error(`[ingest] work=${aw.annictId} ${aw.title}`, e);
      result.errors++;
    }
  }

  await db.from("sync_runs").insert({
    started_at: new Date().toISOString(),
    finished_at: new Date().toISOString(),
    status: result.errors === 0 ? "ok" : "partial",
    created_count: result.works,
    updated_count: result.programs,
    error_count: result.errors,
    note: `ingest season=${seasonSlug}`,
  });

  return result;
}

async function ingestWork(db: ReturnType<typeof getAdminClient>, aw: AnnictWork, result: IngestResult) {
  // 1) しょぼいTIDを特定（AnnictのscPid → PID→TID逆引き）
  let syoboiTid: number | null = null;
  const scPid = aw.programs.find((p) => p.scPid)?.scPid ?? null;
  if (scPid) syoboiTid = await fetchTidByPid(scPid).catch(() => null);

  // 2) しょぼいから正確な放送回を取得
  let syoboiPrograms: SyoboiProgram[] = [];
  if (syoboiTid) {
    syoboiPrograms = await fetchProgramsByTid(syoboiTid).catch(() => []);
  }

  const programDates = syoboiPrograms.map((p) => p.stTime);
  const status = computeStatus(programDates);

  // 3) works upsert（annict_id を一意キーに）
  const { data: workRow, error: workErr } = await db
    .from("works")
    .upsert(
      {
        annict_id: aw.annictId,
        syoboi_tid: syoboiTid,
        title: aw.title,
        title_kana: aw.titleKana,
        title_en: aw.titleEn,
        synopsis: aw.synopsis,
        official_site_url: aw.officialSiteUrl,
        media: aw.media,
        season_year: aw.seasonYear,
        season_name: normalizeSeasonName(aw.seasonName),
        status,
        key_visual_url: aw.imageUrl,
        source_updated_at: new Date().toISOString(),
      },
      { onConflict: "annict_id" },
    )
    .select("id")
    .single();
  if (workErr || !workRow) throw workErr ?? new Error("work upsert failed");
  const workId = workRow.id;

  // 4) episodes upsert（サブタイトルは Annict を初期値に）
  const episodeIdByNumber = new Map<number, string>();
  for (const ep of aw.episodes) {
    if (ep.number == null) continue;
    const { data: epRow } = await db
      .from("episodes")
      .upsert(
        {
          work_id: workId,
          annict_episode_id: ep.annictId,
          number: ep.number,
          number_text: ep.numberText,
          title: ep.title,
          title_source: ep.title ? "annict" : null,
          sort: ep.number,
        },
        { onConflict: "work_id,number" },
      )
      .select("id")
      .single();
    if (epRow) {
      episodeIdByNumber.set(ep.number, epRow.id);
      result.episodes++;
    }
  }

  // 5) キャスト・スタッフ（洗い替え）
  await db.from("work_casts").delete().eq("work_id", workId);
  if (aw.casts.length) {
    await db.from("work_casts").insert(
      aw.casts.map((c, i) => ({
        work_id: workId,
        character_name: c.character,
        person_name: c.name,
        sort: i,
      })),
    );
  }
  await db.from("work_staff").delete().eq("work_id", workId);
  if (aw.staffs.length) {
    await db.from("work_staff").insert(
      aw.staffs.map((s, i) => ({
        work_id: workId,
        role: s.roleText,
        person_name: s.name,
        sort: i,
      })),
    );
  }

  // 6) しょぼいの放送回 → channels / programs / サブタイトルのマージ
  for (const sp of syoboiPrograms) {
    // channel upsert
    const { data: chRow } = await db
      .from("channels")
      .upsert({ name: sp.chName ?? `ch${sp.chId}`, syoboi_chid: sp.chId }, { onConflict: "syoboi_chid" })
      .select("id")
      .single();
    const channelId = chRow?.id ?? null;

    // 対応する episode（話数一致）
    const episodeId = sp.count != null ? episodeIdByNumber.get(sp.count) ?? null : null;

    // サブタイトルのマージ: Annict側が無く、しょぼいに有ればしょぼいを採用（docs/04）
    if (episodeId && sp.subTitle) {
      const { data: epCur } = await db.from("episodes").select("title").eq("id", episodeId).single();
      if (epCur && !epCur.title) {
        await db
          .from("episodes")
          .update({ title: sp.subTitle, title_source: "syoboi" })
          .eq("id", episodeId);
      }
    }

    // programs upsert（syoboi_pid を一意キーに = 重複取り込み防止）
    await db.from("programs").upsert(
      {
        work_id: workId,
        episode_id: episodeId,
        channel_id: channelId,
        count: sp.count,
        start_at: sp.stTime,
        end_at: sp.edTime,
        is_rebroadcast: false,
        syoboi_pid: sp.pid,
      },
      { onConflict: "syoboi_pid" },
    );
    result.programs++;
  }
}
