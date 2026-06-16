import { getAdminClient } from "../supabase/admin.ts";
import {
  fetchWorksBySeason,
  normalizeSeasonName,
  type AnnictWork,
} from "../adapters/annict.ts";
import { fetchSubtitlesByTitle } from "../adapters/syoboi.ts";
import type { WorkStatus } from "../types.ts";

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
export async function ingestSeason(
  seasonSlug: string,
  opts: { metaOnly?: boolean } = {},
): Promise<IngestResult> {
  const db = getAdminClient();
  const result: IngestResult = { works: 0, episodes: 0, programs: 0, errors: 0 };

  const annictWorks = await fetchWorksBySeason(seasonSlug, { metaOnly: opts.metaOnly });

  // 作品を並列処理（Vercelの実行時間制限内に収めるため）。
  const CONCURRENCY = 6;
  for (let i = 0; i < annictWorks.length; i += CONCURRENCY) {
    const chunk = annictWorks.slice(i, i + CONCURRENCY);
    await Promise.all(
      chunk.map(async (aw) => {
        try {
          await ingestWork(db, aw, result, opts.metaOnly ?? false);
          result.works++;
        } catch (e) {
          console.error(`[ingest] work=${aw.annictId} ${aw.title}`, e);
          result.errors++;
        }
      }),
    );
  }

  try {
    await db.from("sync_runs").insert({
      started_at: new Date().toISOString(),
      finished_at: new Date().toISOString(),
      status: result.errors === 0 ? "ok" : "partial",
      created_count: result.works,
      updated_count: result.programs,
      error_count: result.errors,
      note: `ingest season=${seasonSlug} works=${result.works} programs=${result.programs}`,
    });
  } catch {
    /* sync_runs 記録の失敗はジョブ本体に影響させない */
  }

  return result;
}

async function ingestWork(
  db: ReturnType<typeof getAdminClient>,
  aw: AnnictWork,
  result: IngestResult,
  metaOnly = false,
) {
  const mainPrograms = aw.programs.filter((p) => p.startedAt);
  // metaOnly(過去作品の分析用取り込み)は放送回が無いので終了扱いにする
  const status = metaOnly
    ? "finished"
    : computeStatus(mainPrograms.filter((p) => !p.rebroadcast).map((p) => p.startedAt!));

  // 1) works upsert（annict_id を一意キーに）
  //    縦ポスター(poster_url)はここでは触らない（enrich-postersが別管理＝毎日の取込で消えない）
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
        released_on: aw.releasedOn,
        released_on_about: aw.releasedOnAbout,
        status,
        key_visual_url: aw.imageUrl,
        popularity: aw.watchersCount,
        source_updated_at: new Date().toISOString(),
      },
      { onConflict: "annict_id" },
    )
    .select("id")
    .single();
  if (workErr || !workRow) throw workErr ?? new Error("work upsert failed");
  const workId = workRow.id;

  // 2) キャスト・スタッフ（洗い替え。分析にも使うので metaOnly でも常に更新）
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

  // metaOnly（過去作品の分析用取り込み）は放送回・話数を作らずここで終了
  if (metaOnly) return;

  // 3) episodes upsert（バッチ＝1作品1回。サブタイトルは Annict を初期値に）
  const episodeIdByNumber = new Map<number, string>();
  const missingSubtitle: number[] = []; // Annictにサブタイトルが無い話数
  const epRows = aw.episodes
    .filter((e) => e.number != null)
    .map((e) => ({
      work_id: workId,
      annict_episode_id: e.annictId,
      number: e.number,
      number_text: e.numberText,
      title: e.title,
      title_source: e.title ? "annict" : null,
      sort: e.number,
    }));
  if (epRows.length > 0) {
    const { data: inserted } = await db
      .from("episodes")
      .upsert(epRows, { onConflict: "work_id,number" })
      .select("id, number, title");
    for (const e of inserted ?? []) {
      episodeIdByNumber.set(Number(e.number), e.id);
      if (!e.title) missingSubtitle.push(Number(e.number));
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

  // 4) channels（バッチ＝重複局名をまとめて1回）
  const channelIdByName = new Map<string, string>();
  const chNames = [...new Set(mainPrograms.map((p) => p.channelName).filter(Boolean) as string[])];
  if (chNames.length > 0) {
    const { data: chRows } = await db
      .from("channels")
      .upsert(
        chNames.map((name) => ({ name })),
        { onConflict: "name" },
      )
      .select("id, name");
    for (const c of chRows ?? []) channelIdByName.set(c.name, c.id);
  }

  // 5) programs（バッチ＝1作品1回）。annict_program_id が無い回は重複防止できないため除外。
  const progRows = mainPrograms
    .filter((p) => p.annictId != null)
    .map((p) => {
      const startMs = new Date(p.startedAt!).getTime();
      return {
        work_id: workId,
        episode_id: p.episodeNumber != null ? episodeIdByNumber.get(p.episodeNumber) ?? null : null,
        channel_id: p.channelName ? channelIdByName.get(p.channelName) ?? null : null,
        count: p.episodeNumber,
        start_at: p.startedAt,
        end_at: new Date(startMs + 30 * 60000).toISOString(), // 既定30分枠
        is_rebroadcast: p.rebroadcast,
        annict_program_id: p.annictId,
      };
    });
  if (progRows.length > 0) {
    await db.from("programs").upsert(progRows, { onConflict: "annict_program_id" });
    result.programs += progRows.length;
  }
}
