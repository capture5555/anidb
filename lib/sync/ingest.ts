import { getAdminClient } from "@/lib/supabase/admin";
import {
  fetchWorksBySeason,
  normalizeSeasonName,
  type AnnictWork,
} from "@/lib/adapters/annict";
import { fetchSubtitlesByTitle } from "@/lib/adapters/syoboi";
import { fetchPosterUrl } from "@/lib/adapters/anilist";
import type { WorkStatus } from "@/lib/types";

/** 縦ポスター画像を AniList から補完するか（既定オフ。レート制限のため通常は enrich-posters を別途実行） */
const POSTER_ENRICH = process.env.POSTER_ENRICH === "true";

/** Annictにサブタイトルが無い作品を、しょぼいカレンダーで補完するか */
const SYOBOI_BACKFILL = (process.env.SYOBOI_BACKFILL ?? "true") !== "false";

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
  if (now > last + 86400000) return "finished"; // 最終話+1日で終了扱い
  return "airing";
}

/**
 * シーズン取り込み（docs/08 ingestジョブ）。
 * Annict単体で 作品メタ + 放送スケジュール(日時/局/話数/サブタイトル) を取得しDBへ。
 * ※ Annict.programs が放送情報を直接持つため、しょぼいカレンダーとの紐付けは不要になった。
 *   （サブタイトルの欠けを将来しょぼいで補完したい場合は lib/adapters/syoboi.ts を利用可能）
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

async function ingestWork(
  db: ReturnType<typeof getAdminClient>,
  aw: AnnictWork,
  result: IngestResult,
) {
  const mainPrograms = aw.programs.filter((p) => p.startedAt);
  const status = computeStatus(mainPrograms.filter((p) => !p.rebroadcast).map((p) => p.startedAt!));

  // キービジュアルは縦ポスター優先（AniList）→ 無ければAnnictの画像
  let keyVisualUrl = aw.imageUrl;
  if (POSTER_ENRICH) {
    const poster = await fetchPosterUrl(aw.title, aw.seasonYear).catch(() => null);
    if (poster) keyVisualUrl = poster;
  }

  // 1) works upsert（annict_id を一意キーに）
  const { data: workRow, error: workErr } = await db
    .from("works")
    .upsert(
      {
        annict_id: aw.annictId,
        title: aw.title,
        title_kana: aw.titleKana,
        title_en: aw.titleEn,
        synopsis: aw.synopsis,
        official_site_url: aw.officialSiteUrl,
        media: aw.media,
        season_year: aw.seasonYear,
        season_name: normalizeSeasonName(aw.seasonName),
        status,
        key_visual_url: keyVisualUrl,
        popularity: aw.watchersCount,
        source_updated_at: new Date().toISOString(),
      },
      { onConflict: "annict_id" },
    )
    .select("id")
    .single();
  if (workErr || !workRow) throw workErr ?? new Error("work upsert failed");
  const workId = workRow.id;

  // 2) episodes upsert（サブタイトルは Annict を初期値に）
  const episodeIdByNumber = new Map<number, string>();
  const missingSubtitle: number[] = []; // Annictにサブタイトルが無い話数
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
      if (!ep.title) missingSubtitle.push(ep.number);
      result.episodes++;
    }
  }

  // 2-b) Annictにサブタイトルが無い回を、しょぼいカレンダーで補完（docs/04 マージルール）
  if (SYOBOI_BACKFILL && missingSubtitle.length > 0) {
    try {
      const subs = await fetchSubtitlesByTitle(aw.title, aw.seasonYear);
      for (const num of missingSubtitle) {
        const sub = subs.get(num);
        const epId = episodeIdByNumber.get(num);
        if (sub && epId) {
          await db
            .from("episodes")
            .update({ title: sub, title_source: "syoboi" })
            .eq("id", epId);
        }
      }
    } catch (e) {
      console.error(`[ingest] syoboi backfill failed for ${aw.title}`, e);
    }
  }

  // 3) キャスト・スタッフ（洗い替え）
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

  // 4) channels / programs（Annictの放送回を直接登録。話数→episode_id を対応付け）
  const channelIdByName = new Map<string, string>();
  for (const p of mainPrograms) {
    if (!p.channelName) continue;
    if (!channelIdByName.has(p.channelName)) {
      const { data: chRow } = await db
        .from("channels")
        .upsert({ name: p.channelName }, { onConflict: "name" })
        .select("id")
        .single();
      if (chRow) channelIdByName.set(p.channelName, chRow.id);
    }
  }

  for (const p of mainPrograms) {
    const episodeId = p.episodeNumber != null ? episodeIdByNumber.get(p.episodeNumber) ?? null : null;
    const startMs = new Date(p.startedAt!).getTime();
    await db.from("programs").upsert(
      {
        work_id: workId,
        episode_id: episodeId,
        channel_id: p.channelName ? channelIdByName.get(p.channelName) ?? null : null,
        count: p.episodeNumber,
        start_at: p.startedAt,
        end_at: new Date(startMs + 30 * 60000).toISOString(), // 既定30分枠
        is_rebroadcast: p.rebroadcast,
        annict_program_id: p.annictId,
      },
      { onConflict: "annict_program_id" },
    );
    result.programs++;
  }
}
