/**
 * X(Twitter) バズの読み取りデータ層。
 *
 * collector(scripts/collect-x-buzz.ts)が analytics_x_buzz に書き込む
 *   - 作品レベル行（episode_id = null）
 *   - 話数レベル行（episode_id 設定）
 * を、ページが使いやすい形に整形して返す。
 *
 * ★ すべて「防御的」: マイグレーション 0013 適用前（summary/citations/episode_id 未作成）や
 *   0012 適用前（テーブル未作成）でもクラッシュさせない。失敗・欠落はすべて null/[] に正規化する。
 *   そのため新カラムを含む select はまず full 版を試し、失敗したら最小カラムへフォールバックする。
 */
import { getAdminClient } from "../supabase/admin.ts";
import { memoizeTTL } from "../cache.ts";
import { fromSnapshotOrLive } from "./snapshots.ts";
import { getCollectedLogs } from "./collectedLogs.ts";
import { seasonOf } from "../season.ts";

const chunk = <T,>(arr: T[], size: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
};

export interface XBuzzCitation {
  url: string;
}

/** 作品レベルの最新バズ（getWorkXBuzz が返す latest）。 */
export interface WorkXBuzzLatest {
  volume: number;
  sentiment: string | null;
  topics: string[];
  summary: string | null;
  citations: XBuzzCitation[];
  capturedAt: string;
}

/** 話数レベルのバズ1件（話数ごとに最新1件へ集約済み）。 */
export interface EpisodeXBuzz {
  episodeId: string | null;
  episodeNumber: number | null;
  episodeLabel: string;
  volume: number;
  sentiment: string | null;
  topics: string[];
  summary: string | null;
  citations: XBuzzCitation[];
  capturedAt: string;
}

export interface WorkXBuzz extends WorkXBuzzLatest {
  /** 作品レベル行の推移（時系列昇順, 直近~30件）。sentiment も日別評判の集計に使う。 */
  trend: { capturedAt: string; volume: number; sentiment: string | null }[];
  /** 話数レベル行（新しい順）。 */
  episodes: EpisodeXBuzz[];
}

export interface CohortXBuzz {
  workId: string;
  title: string;
  posterUrl: string | null;
  volume: number;
  sentiment: string | null;
}

export interface XBuzzVsJikkyo {
  workId: string;
  title: string;
  xVolume: number;
  jikkyoComments: number;
}

/** jsonb/任意値を string[] に正規化（topics 用）。 */
function toStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.map((x) => String(x)).filter((s) => s.length > 0).slice(0, 30);
}

/**
 * Grok(x_search)の生 answer markdown を、画面表示用の素のテキストに整える純関数。
 *
 * collector は res.answer をそのまま summary に保存するため、回答末尾の指示エコー
 * （BUZZ_JSON: {...} / POSTS_JSON: [...]）や markdown 装飾（**強調**・脚注 [[1]](url)・
 * 見出し #）がそのまま混入する。これらを取り除いて「作品の声」を読みやすくする。
 *
 * 既存の蓄積行にも効くよう、書き込み時ではなく読み取り時にここで正規化する。
 * いかなる入力でも例外を投げず、null/空なら null を返す。
 */
export function cleanXSummary(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let s = String(raw);

  // 1) 末尾の指示エコー（BUZZ_JSON: / POSTS_JSON:）以降を丸ごと切り落とす。
  //    行頭の markdown 装飾（**, -, #, 空白）が付いていても拾えるようにする。
  const cut = s.search(/(^|\n)\s*(?:[*_#>\-\s]*)?(?:BUZZ_JSON|POSTS_JSON)\s*[:：]/i);
  if (cut >= 0) s = s.slice(0, cut);

  // 2) 脚注リンク [[1]](url) / [1](url) を除去（番号付き引用マーカー）。
  s = s.replace(/\[\[(\d+)\]\]\([^)]*\)/g, "");
  s = s.replace(/\[(\d+)\]\([^)]*\)/g, "");
  // 3) 通常の markdown リンク [表示文字](url) は表示文字だけ残す。
  s = s.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1");
  // 4) 裸の参照マーカー [1] / [1, 2] を除去。
  s = s.replace(/\[\d+(?:\s*,\s*\d+)*\]/g, "");
  // 5) 強調・コード装飾 (**bold** / __bold__ / *italic* / `code`) のマーカーを外す。
  s = s.replace(/\*\*([^*]+)\*\*/g, "$1");
  s = s.replace(/__([^_]+)__/g, "$1");
  s = s.replace(/(^|[^*])\*(?!\s)([^*\n]+?)\*(?!\*)/g, "$1$2");
  s = s.replace(/`([^`]+)`/g, "$1");
  // 6) 行頭の見出し/引用/箇条書きマーカーを外す。
  s = s.replace(/^\s{0,3}#{1,6}\s+/gm, "");
  s = s.replace(/^\s{0,3}>\s?/gm, "");
  s = s.replace(/^\s{0,3}[-*]\s+/gm, "・");
  // 7) 脚注・装飾を抜いた跡に残る連続スペースを1つに畳み、和文句読点の前の空白を除く。
  s = s.replace(/[ \t]{2,}/g, " ");
  s = s.replace(/ +([。、！？」』）)])/g, "$1");
  // 8) 3連以上の改行は2連に圧縮し、各行末の空白を落とし、全体を trim。
  s = s.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();

  return s.length > 0 ? s : null;
}

/** jsonb/任意値を {url}[] に正規化（citations 用）。 */
function toCitations(v: unknown): XBuzzCitation[] {
  if (!Array.isArray(v)) return [];
  const out: XBuzzCitation[] = [];
  for (const c of v) {
    const url =
      c && typeof c === "object" ? (c as Record<string, unknown>).url : undefined;
    if (typeof url === "string" && url.length > 0) out.push({ url });
  }
  return out.slice(0, 12);
}

/**
 * 1作品の X バズを読む。作品レベル最新行＋推移＋話数レベル行をまとめて返す。
 * 行が無い / テーブル・カラム未作成など、いかなる失敗でも null を返す。
 */
export async function getWorkXBuzz(workId: string): Promise<WorkXBuzz | null> {
  try {
    const db = getAdminClient();

    // --- 作品レベル行（episode_id null）を新しい順に最大30件 ---
    // full 版（summary/citations/episode_id 含む）をまず試し、未作成なら最小版へフォールバック。
    let workRows: Record<string, unknown>[] | null = null;
    let hasExtCols = true;
    {
      const full = await db
        .from("analytics_x_buzz")
        .select("captured_at, volume_score, sentiment, topics, summary, citations")
        .eq("work_id", workId)
        .is("episode_id", null)
        .order("captured_at", { ascending: false })
        .limit(30);
      if (full.error) {
        hasExtCols = false;
        const basic = await db
          .from("analytics_x_buzz")
          .select("captured_at, volume_score, sentiment, topics")
          .eq("work_id", workId)
          .order("captured_at", { ascending: false })
          .limit(30);
        if (basic.error) return null;
        workRows = (basic.data ?? []) as Record<string, unknown>[];
      } else {
        workRows = (full.data ?? []) as Record<string, unknown>[];
      }
    }

    if (!workRows || workRows.length === 0) return null;

    const latestRow = workRows[0];
    const latest: WorkXBuzzLatest = {
      volume: Number(latestRow.volume_score) || 0,
      sentiment: (latestRow.sentiment as string | null) ?? null,
      topics: toStringArray(latestRow.topics),
      summary: cleanXSummary(latestRow.summary as string | null),
      citations: toCitations(latestRow.citations),
      capturedAt: String(latestRow.captured_at),
    };

    // 推移は時系列昇順（古い→新しい）。sentiment も保持して日別の評判集計に使う。
    const trend = [...workRows]
      .map((r) => ({
        capturedAt: String(r.captured_at),
        volume: Number(r.volume_score) || 0,
        sentiment: (r.sentiment as string | null) ?? null,
      }))
      .sort((a, b) => a.capturedAt.localeCompare(b.capturedAt));

    // --- 話数レベル行（新カラムがある場合のみ） ---
    let episodes: EpisodeXBuzz[] = [];
    if (hasExtCols) {
      const epRes = await db
        .from("analytics_x_buzz")
        .select(
          "episode_id, captured_at, volume_score, sentiment, topics, summary, citations, episodes(number, number_text)",
        )
        .eq("work_id", workId)
        .not("episode_id", "is", null)
        .order("captured_at", { ascending: false })
        .limit(60);
      if (!epRes.error) {
        // captured_at 降順で読んでいるので、話数(episode_id)ごとに最初に出た行＝最新を採用する。
        const byEpisode = new Map<string, EpisodeXBuzz>();
        for (const r of epRes.data ?? []) {
          const o = r as Record<string, unknown>;
          const ep = (r as { episodes?: { number?: number | null; number_text?: string | null } })
            .episodes;
          const episodeId = (o.episode_id as string | null) ?? null;
          const dedupeKey = episodeId ?? String(o.captured_at);
          if (byEpisode.has(dedupeKey)) continue;
          const label =
            ep?.number_text ?? (ep?.number != null ? `第${ep.number}話` : "話数不明");
          byEpisode.set(dedupeKey, {
            episodeId,
            episodeNumber: ep?.number ?? null,
            episodeLabel: label,
            volume: Number(o.volume_score) || 0,
            sentiment: (o.sentiment as string | null) ?? null,
            topics: toStringArray(o.topics),
            summary: cleanXSummary(o.summary as string | null),
            citations: toCitations(o.citations),
            capturedAt: String(o.captured_at),
          });
        }
        // 話数の新しい順（number 降順、未設定は末尾）に並べる。
        episodes = [...byEpisode.values()].sort((a, b) => {
          if (a.episodeNumber == null && b.episodeNumber == null) return 0;
          if (a.episodeNumber == null) return 1;
          if (b.episodeNumber == null) return -1;
          return b.episodeNumber - a.episodeNumber;
        });
      }
    }

    return { ...latest, trend, episodes };
  } catch {
    return null;
  }
}

/** getWorkXPosts が返す1ポスト。 */
export interface WorkXPost {
  statusId: string;
  url: string;
  text: string | null;
  /** posted_at（ISO 文字列）。 */
  postedAt: string;
  episodeId: string | null;
}

/**
 * 1作品の蓄積済み生 X ポストを新しい順(posted_at 降順)で返す。
 * テーブル未作成(0014 未適用)・失敗・欠落はすべて [] に正規化（防御的）。
 */
export async function getWorkXPosts(workId: string, limit = 600): Promise<WorkXPost[]> {
  try {
    const db = getAdminClient();
    const { data, error } = await db
      .from("analytics_x_posts")
      .select("status_id, url, text, posted_at, episode_id")
      .eq("work_id", workId)
      .order("posted_at", { ascending: false })
      .limit(Math.max(1, Math.min(limit, 2000)));
    if (error) return [];
    return (data ?? []).map((r) => {
      const o = r as Record<string, unknown>;
      return {
        statusId: String(o.status_id),
        url: String(o.url),
        text: (o.text as string | null) ?? null,
        postedAt: String(o.posted_at),
        episodeId: (o.episode_id as string | null) ?? null,
      };
    });
  } catch {
    return [];
  }
}

/** 今期の放送中TV作品（id, title, poster_url）を取得。失敗は []。 */
async function currentSeasonAiringWorks(): Promise<
  { id: string; title: string; poster_url: string | null }[]
> {
  try {
    const db = getAdminClient();
    const { year, season } = seasonOf(new Date());
    const { data, error } = await db
      .from("works")
      .select("id, title, poster_url")
      .eq("season_year", year)
      .eq("season_name", season)
      .eq("status", "airing")
      .eq("media", "tv")
      .order("popularity", { ascending: false })
      .limit(200);
    if (error) return [];
    return (data ?? []) as { id: string; title: string; poster_url: string | null }[];
  } catch {
    return [];
  }
}

/**
 * 今期放送中作品について、作品レベルの「最新 volume」を volume 降順→最新順で返す。
 * 失敗・欠落はすべて [] に正規化（防御的）。
 */
async function getCohortXBuzzUncached(limit = 20): Promise<CohortXBuzz[]> {
  try {
    const db = getAdminClient();
    const works = await currentSeasonAiringWorks();
    if (works.length === 0) return [];
    const byId = new Map(works.map((w) => [w.id, w]));
    const workIds = works.map((w) => w.id);

    // 作品ごとの最新作品レベル行（episode_id null）を集める。
    // captured_at 降順で読み、各 work の最初の行を採用する。
    const latest = new Map<string, { volume: number; sentiment: string | null; capturedAt: string }>();
    for (const ids of chunk(workIds, 100)) {
      const { data, error } = await db
        .from("analytics_x_buzz")
        .select("work_id, captured_at, volume_score, sentiment")
        .in("work_id", ids)
        .is("episode_id", null)
        .order("captured_at", { ascending: false })
        .limit(2000);
      if (error) {
        // episode_id カラム未作成なら .is("episode_id", null) で落ちる → フォールバック。
        const basic = await db
          .from("analytics_x_buzz")
          .select("work_id, captured_at, volume_score, sentiment")
          .in("work_id", ids)
          .order("captured_at", { ascending: false })
          .limit(2000);
        if (basic.error) continue;
        for (const r of basic.data ?? []) {
          const wid = r.work_id as string;
          if (!latest.has(wid)) {
            latest.set(wid, {
              volume: Number(r.volume_score) || 0,
              sentiment: (r.sentiment as string | null) ?? null,
              capturedAt: String(r.captured_at),
            });
          }
        }
        continue;
      }
      for (const r of data ?? []) {
        const wid = r.work_id as string;
        if (!latest.has(wid)) {
          latest.set(wid, {
            volume: Number(r.volume_score) || 0,
            sentiment: (r.sentiment as string | null) ?? null,
            capturedAt: String(r.captured_at),
          });
        }
      }
    }

    const rows: CohortXBuzz[] = [];
    for (const [wid, v] of latest) {
      const w = byId.get(wid);
      if (!w) continue;
      rows.push({
        workId: wid,
        title: w.title,
        posterUrl: w.poster_url ?? null,
        volume: v.volume,
        sentiment: v.sentiment,
      });
    }
    rows.sort((a, b) => b.volume - a.volume);
    return rows.slice(0, limit);
  } catch {
    return [];
  }
}

/**
 * 今期コホートの X バズ。30分メモ化＋スナップショット("x_cohort_buzz")経由。
 * いずれの層も欠落時は live/[] に落ちるため防御的。
 */
export const getCohortXBuzz = memoizeTTL(
  (limit = 20): Promise<CohortXBuzz[]> =>
    fromSnapshotOrLive("x_cohort_buzz", () => getCohortXBuzzUncached(limit)).catch(() => []),
  (limit = 20) => `x_cohort_buzz:${limit}`,
  30 * 60 * 1000,
);

/** compute-snapshots から呼ぶ素の計算（スナップショット/メモ化を経由しない）。 */
export function getCohortXBuzzForSnapshot(limit = 20): Promise<CohortXBuzz[]> {
  return getCohortXBuzzUncached(limit);
}

/* ---------------------------------------------------------------- episode buzz leaders */

/** 話数別バズ上位の1行（クール横断で「いま盛り上がっている話数」）。 */
export interface EpisodeBuzzLeader {
  workId: string;
  title: string;
  posterUrl: string | null;
  episodeId: string | null;
  episodeLabel: string;
  volume: number;
  sentiment: string | null;
  topics: string[];
  capturedAt: string;
}

/**
 * 今期作品の話数レベル行を横断し、話数ごとに最新1件へ集約して volume 降順で返す。
 * 「クール全体でいま盛り上がっている個別の話数」を見るため。
 * episode_id カラム未作成・失敗・欠落はすべて []（防御的）。
 */
async function getEpisodeBuzzLeadersUncached(limit = 12): Promise<EpisodeBuzzLeader[]> {
  try {
    const db = getAdminClient();
    const works = await currentSeasonAiringWorks();
    if (works.length === 0) return [];
    const byId = new Map(works.map((w) => [w.id, w]));
    const workIds = works.map((w) => w.id);

    // 話数ごとに最新1件（work_id + episode_id をキーに captured_at 降順の最初）を採用。
    const latest = new Map<string, EpisodeBuzzLeader>();
    for (const ids of chunk(workIds, 100)) {
      const res = await db
        .from("analytics_x_buzz")
        .select(
          "work_id, episode_id, captured_at, volume_score, sentiment, topics, episodes(number, number_text)",
        )
        .in("work_id", ids)
        .not("episode_id", "is", null)
        .order("captured_at", { ascending: false })
        .limit(3000);
      // チャンク単位のエラーはそのチャンクだけスキップ（episode_id 未作成なら全チャンク
      // 失敗して結果は空＝従来どおり機能オフ。一時エラー時は他チャンクの結果を保てる）。
      if (res.error) continue;
      for (const r of res.data ?? []) {
        const o = r as Record<string, unknown>;
        const wid = o.work_id as string;
        const eid = (o.episode_id as string | null) ?? null;
        const key = `${wid}:${eid}`;
        if (latest.has(key)) continue;
        const w = byId.get(wid);
        if (!w) continue;
        const ep = (r as { episodes?: { number?: number | null; number_text?: string | null } })
          .episodes;
        const label = ep?.number_text ?? (ep?.number != null ? `第${ep.number}話` : "話数不明");
        latest.set(key, {
          workId: wid,
          title: w.title,
          posterUrl: w.poster_url ?? null,
          episodeId: eid,
          episodeLabel: label,
          volume: Number(o.volume_score) || 0,
          sentiment: (o.sentiment as string | null) ?? null,
          topics: toStringArray(o.topics),
          capturedAt: String(o.captured_at),
        });
      }
    }

    const rows = [...latest.values()];
    rows.sort((a, b) => b.volume - a.volume || b.capturedAt.localeCompare(a.capturedAt));
    return rows.slice(0, limit);
  } catch {
    return [];
  }
}

/** 話数別バズ上位（クール横断）。30分メモ化。失敗時は []。 */
export const getEpisodeBuzzLeaders = memoizeTTL(
  (limit = 12): Promise<EpisodeBuzzLeader[]> => getEpisodeBuzzLeadersUncached(limit).catch(() => []),
  (limit = 12) => `x_episode_leaders:${limit}`,
  30 * 60 * 1000,
);

/* ---------------------------------------------------------------- topic leaders */

/** トピック頻度1件。 */
export interface XTopicLeader {
  topic: string;
  count: number;
  /** そのトピックを含む作品名のサンプル（最大3件）。 */
  sampleTitles: string[];
}

/**
 * 今期作品の作品レベル最新行を横断し、topics の出現頻度を集計して降順で返す。
 * 「クール全体でいま話題になっているキーワード」を見るため。
 * 表記ゆれを抑えるため小文字＋trim で同一視するが、表示は最頻出の原表記を使う。
 * 失敗・欠落はすべて []（防御的）。
 */
async function getXBuzzTopicLeadersUncached(limit = 24): Promise<XTopicLeader[]> {
  try {
    const db = getAdminClient();
    const works = await currentSeasonAiringWorks();
    if (works.length === 0) return [];
    const byId = new Map(works.map((w) => [w.id, w]));
    const workIds = works.map((w) => w.id);

    // 作品ごとの最新作品レベル行の topics を集める。
    const latestTopics = new Map<string, { topics: string[]; title: string }>();
    for (const ids of chunk(workIds, 100)) {
      let rows: Record<string, unknown>[] = [];
      const res = await db
        .from("analytics_x_buzz")
        .select("work_id, captured_at, topics")
        .in("work_id", ids)
        .is("episode_id", null)
        .order("captured_at", { ascending: false })
        .limit(2000);
      if (res.error) {
        const basic = await db
          .from("analytics_x_buzz")
          .select("work_id, captured_at, topics")
          .in("work_id", ids)
          .order("captured_at", { ascending: false })
          .limit(2000);
        if (basic.error) continue;
        rows = (basic.data ?? []) as Record<string, unknown>[];
      } else {
        rows = (res.data ?? []) as Record<string, unknown>[];
      }
      for (const r of rows) {
        const wid = r.work_id as string;
        if (latestTopics.has(wid)) continue;
        const w = byId.get(wid);
        if (!w) continue;
        latestTopics.set(wid, { topics: toStringArray(r.topics), title: w.title });
      }
    }
    if (latestTopics.size === 0) return [];

    // 正規化キー(小文字trim)ごとに件数・原表記の頻度・作品サンプルを集計。
    const agg = new Map<
      string,
      { count: number; labels: Map<string, number>; titles: Set<string> }
    >();
    for (const { topics, title } of latestTopics.values()) {
      const seen = new Set<string>(); // 同一作品内の重複トピックは1回だけ数える
      for (const t of topics) {
        const norm = t.trim().toLowerCase();
        if (norm.length === 0 || seen.has(norm)) continue;
        seen.add(norm);
        const cur = agg.get(norm) ?? { count: 0, labels: new Map(), titles: new Set() };
        cur.count += 1;
        cur.labels.set(t, (cur.labels.get(t) ?? 0) + 1);
        cur.titles.add(title);
        agg.set(norm, cur);
      }
    }

    const out: XTopicLeader[] = [];
    for (const v of agg.values()) {
      if (v.count < 2) continue; // 1作品だけのトピックはノイズとして除外
      const topic = [...v.labels.entries()].sort((a, b) => b[1] - a[1])[0][0];
      out.push({ topic, count: v.count, sampleTitles: [...v.titles].slice(0, 3) });
    }
    out.sort((a, b) => b.count - a.count);
    return out.slice(0, limit);
  } catch {
    return [];
  }
}

/** クール横断トピックランキング。30分メモ化。失敗時は []。 */
export const getXBuzzTopicLeaders = memoizeTTL(
  (limit = 24): Promise<XTopicLeader[]> => getXBuzzTopicLeadersUncached(limit).catch(() => []),
  (limit = 24) => `x_topic_leaders:${limit}`,
  30 * 60 * 1000,
);

/**
 * 今期作品のうち「最新 X volume」と「実況コメント総数」の両方を持つものを返す。
 * niconico × X の相関散布図用。失敗・欠落はすべて []（防御的）。
 */
export async function getXBuzzVsJikkyo(limit = 30): Promise<XBuzzVsJikkyo[]> {
  try {
    const db = getAdminClient();
    const works = await currentSeasonAiringWorks();
    if (works.length === 0) return [];
    const byId = new Map(works.map((w) => [w.id, w]));
    const workIds = works.map((w) => w.id);

    // --- 最新 X volume（作品レベル）を work ごとに ---
    const xVol = new Map<string, number>();
    for (const ids of chunk(workIds, 100)) {
      let rows: { work_id: string; volume_score: number }[] = [];
      const res = await db
        .from("analytics_x_buzz")
        .select("work_id, captured_at, volume_score")
        .in("work_id", ids)
        .is("episode_id", null)
        .order("captured_at", { ascending: false })
        .limit(2000);
      if (res.error) {
        const basic = await db
          .from("analytics_x_buzz")
          .select("work_id, captured_at, volume_score")
          .in("work_id", ids)
          .order("captured_at", { ascending: false })
          .limit(2000);
        if (basic.error) continue;
        rows = (basic.data ?? []) as { work_id: string; volume_score: number }[];
      } else {
        rows = (res.data ?? []) as { work_id: string; volume_score: number }[];
      }
      for (const r of rows) {
        if (!xVol.has(r.work_id)) xVol.set(r.work_id, Number(r.volume_score) || 0);
      }
    }
    if (xVol.size === 0) return [];

    // --- 実況コメント総数: collected log → 番組 → 作品で集計 ---
    const allLogs = await getCollectedLogs();
    if (allLogs.length === 0) return [];
    const countByProgram = new Map(allLogs.map((l) => [l.program_id, l.comment_count]));
    const programIds = [...countByProgram.keys()];

    const jikkyoByWork = new Map<string, number>();
    for (const ids of chunk(programIds, 150)) {
      const { data, error } = await db
        .from("programs")
        .select("id, work_id")
        .in("id", ids);
      if (error) continue;
      for (const p of data ?? []) {
        const wid = p.work_id as string;
        if (!xVol.has(wid)) continue; // 今期かつ X volume 有りのみ
        const c = countByProgram.get(p.id as string) ?? 0;
        jikkyoByWork.set(wid, (jikkyoByWork.get(wid) ?? 0) + c);
      }
    }

    const rows: XBuzzVsJikkyo[] = [];
    for (const [wid, comments] of jikkyoByWork) {
      const w = byId.get(wid);
      const vol = xVol.get(wid);
      if (!w || vol == null || comments <= 0) continue;
      rows.push({ workId: wid, title: w.title, xVolume: vol, jikkyoComments: comments });
    }
    // 散布図用: コメント総数の多い順に上限。
    rows.sort((a, b) => b.jikkyoComments - a.jikkyoComments);
    return rows.slice(0, limit);
  } catch {
    return [];
  }
}
