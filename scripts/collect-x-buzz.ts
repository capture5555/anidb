/**
 * X(Twitter) のアニメ「バズ」状況を収集する CLI（GitHub Actions cron）。
 *   npm run collect-x-buzz
 * 必要env: NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY
 *
 * 2つの収集モードがある（Hermes モードが優先）:
 *
 *   Mode B (Hermes / 優先): isHermesConfigured() が true のとき。
 *     NousResearch hermes-agent(xAI 公認) の x_search_tool を uvx 経由で呼ぶ。
 *     認証は ~/.hermes（ローカルで `uvx --from hermes-agent hermes auth add xai-oauth`）。
 *     CI ではワークフローが HERMES_X_ENABLED=1 を立てる。
 *     ★ これは「X 検索の生データ」ではなく Grok による X 反応の分析・要約である。
 *       したがって volume_score は投稿量の推定（体感）にすぎず、正確な件数ではない。
 *
 *   Mode A (XAI / フォールバック): Hermes 未設定だが XAI_API_KEY もしくは
 *     (XAI_REFRESH_TOKEN + XAI_OAUTH_CLIENT_ID) があるとき。lib/adapters/xai.ts の
 *     searchAnimeBuzz を使う。
 *
 *   どちらも未設定なら何もせず exit 0（cron を失敗扱いにしない）。
 *
 * 動作（共通）:
 *   - 今期(現シーズン)の放送中(airing)TV作品を popularity 降順で X_BUZZ_LIMIT(既定12)件取得。
 *   - 各作品について1行を analytics_x_buzz に insert。
 *   - 作品ごとに try/catch。テーブル未作成(マイグレーション前)なら気づいて穏当に停止。
 *   - クォータ/レイテンシ配慮で各呼び出し間にスリープ。
 */
import { readFileSync } from "node:fs";

// .env.local を手動ロード（単体nodeスクリプトはNext.jsと違い自動で読まないため）
try {
  const env = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
  for (const line of env.split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
} catch {
  /* 環境変数があれば動く */
}

import { getAdminClient } from "../lib/supabase/admin.ts";
import { isXaiConfigured, searchAnimeBuzz } from "../lib/adapters/xai.ts";
import { buzzFromAnswer, hermesXSearch, isHermesConfigured } from "../lib/adapters/hermesX.ts";
import { parsePostsFromAnswer } from "../lib/adapters/xPosts.ts";
import { seasonOf, formatSeason } from "../lib/season.ts";
import { writeSnapshot } from "../lib/analytics/snapshots.ts";
import { cleanXSummary } from "../lib/analytics/xbuzz.ts";
import { SEASON_COMMENT_KEY } from "../lib/analytics/seasonComment.ts";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** テーブル未作成(42P01)エラーの検出（マイグレーション前を穏当に扱う） */
function isMissingTable(error: unknown): boolean {
  const e = error as { code?: string; message?: string } | null;
  if (!e) return false;
  return e.code === "42P01" || /analytics_x_buzz.*does not exist/i.test(e.message ?? "");
}

/**
 * カラム未作成(42703)エラーの検出（マイグレーション 0013 適用前を穏当に扱う）。
 * summary/citations/episode_id を含む insert が落ちたら、これらを外して再試行する。
 */
function isMissingColumn(error: unknown): boolean {
  const e = error as { code?: string; message?: string } | null;
  if (!e) return false;
  return e.code === "42703" || /column/i.test(e.message ?? "");
}

/**
 * Mode B プロンプト末尾に付与する「実ポスト出力」指示。
 * 回答末尾に POSTS_JSON ブロックで実際の status フル URL と本文抜粋を出させ、
 * parsePostsFromAnswer で抽出 → Snowflake で実時刻を復元 → analytics_x_posts に蓄積する。
 */
const POSTS_PROMPT_SUFFIX =
  `また回答の最後に、見つかった実際のXポストを最大20件、必ず ` +
  `POSTS_JSON: [{"url":"https://x.com/<user>/status/<id>","text":"<本文の短い抜粋>"}] ` +
  `の形式(URLは必ずstatusのフルURL)で出力してください。`;

/** 投稿テーブル未作成(42P01)の harvest スキップ警告を1ラン1回に抑えるフラグ。 */
let postsTableMissingLogged = false;

/**
 * analytics_x_posts への防御的バルク upsert。
 *   - parsePostsFromAnswer の結果を行へ変換し onConflict "work_id,status_id" で ignoreDuplicates。
 *   - テーブル未作成(42P01)なら1ラン1回だけログして 0 を返す（buzz 行は別途 insert 済み）。
 *   - その他失敗も throw せず 0 を返す（cron を落とさない）。
 * 戻り値は試行件数（取り込もうとしたポスト数）。
 */
async function harvestPosts(
  db: ReturnType<typeof getAdminClient>,
  workId: string,
  episodeId: string | null,
  answer: string,
  citations: { url: string }[],
): Promise<number> {
  const posts = parsePostsFromAnswer(answer, citations);
  if (posts.length === 0) return 0;
  const rows = posts.map((p) => ({
    work_id: workId,
    episode_id: episodeId,
    status_id: p.statusId,
    url: p.url,
    text: p.text,
    posted_at: p.postedAt,
  }));
  try {
    const { error } = await db
      .from("analytics_x_posts")
      .upsert(rows, { onConflict: "work_id,status_id", ignoreDuplicates: true });
    if (error) {
      if (isMissingTable(error)) {
        if (!postsTableMissingLogged) {
          postsTableMissingLogged = true;
          console.warn(
            "[collect-x-buzz] analytics_x_posts 未作成のため harvest をスキップ（0014_x_posts.sql 適用前）",
          );
        }
        return 0;
      }
      console.error("[collect-x-buzz] posts upsert 失敗:", error.message ?? error);
      return 0;
    }
    return rows.length;
  } catch (e) {
    console.error("[collect-x-buzz] posts harvest 例外:", e);
    return 0;
  }
}

const WINDOW_HOURS = 24;
/** summary は長くなりがちなので保存前に丸める上限。 */
const SUMMARY_MAX = 4000;
/** citations の保存上限件数。 */
const CITATIONS_CAP = 12;

/** URL 配列を重複排除しつつ件数上限でまとめる。 */
function dedupCitations(citations: { url: string }[]): { url: string }[] {
  const seen = new Set<string>();
  const out: { url: string }[] = [];
  for (const c of citations) {
    const url = c?.url;
    if (typeof url === "string" && url.length > 0 && !seen.has(url)) {
      seen.add(url);
      out.push({ url });
      if (out.length >= CITATIONS_CAP) break;
    }
  }
  return out;
}

interface BuzzRow {
  volume_score: number;
  sentiment: string | null;
  topics: string[];
  quotes: string[];
  /** Mode B のみ: Grok の回答 markdown（~4000字に丸め）。Mode A は null。 */
  summary: string | null;
  /** Mode B のみ: 重複排除・上限済みの引用 URL。Mode A は []。 */
  citations: { url: string }[];
  /** Mode B のみ: harvest 用の生 answer（丸めなし）。Mode A は null。 */
  rawAnswer?: string | null;
  /** Mode B のみ: harvest 用の生 citations（丸めなし）。Mode A は undefined。 */
  rawCitations?: { url: string }[];
}

/** Mode B: Hermes(x_search_tool) で作品のバズを導出する。失敗時は null。 */
async function collectHermes(title: string): Promise<BuzzRow | null> {
  const query =
    `アニメ『${title}』に関する直近24時間のX上の反応を検索して要約してください。` +
    `最後に必ず1行で BUZZ_JSON: {"volume":0..5,"sentiment":"positive|mixed|negative",` +
    `"topics":["…"],"quotes":["…"]} を出力してください` +
    `（volumeは投稿量の体感: 0=ほぼ無し,5=トレンド級）。` +
    POSTS_PROMPT_SUFFIX;
  const res = await hermesXSearch(query);
  if (!res) return null;
  const buzz = buzzFromAnswer(title, res.answer, res.citations.length);
  return {
    ...buzz,
    summary: res.answer ? res.answer.trim().slice(0, SUMMARY_MAX) : null,
    citations: dedupCitations(res.citations),
    rawAnswer: res.answer,
    rawCitations: res.citations,
  };
}

/**
 * 今期アニメ全体の「所感」コメントを x_search で1クエリ生成し、スナップショットへ保存する。
 * メイン分析画面に短いリード文として表示する用途。失敗は呼び出し側で握りつぶす。
 */
async function generateSeasonComment(
  year: number,
  season: Parameters<typeof formatSeason>[1],
): Promise<void> {
  const label = formatSeason(year, season);
  const query =
    `${label}に放送中のテレビアニメ全体について、直近1週間でX(Twitter)上で特に話題・` +
    `高評価の作品や、盛り上がっているジャンル・全体の傾向を検索してください。` +
    `アニメ業界の関係者向けに、要点を3〜4文・約200字以内の日本語で簡潔にまとめてください。` +
    `箇条書き・見出し・URL・脚注は使わず、地の文だけで述べてください。`;
  const res = await hermesXSearch(query);
  const text = cleanXSummary(res?.answer ?? null);
  if (!text) {
    console.log("[collect-x-buzz] 所感: 生成結果が空のためスキップ");
    return;
  }
  await writeSnapshot(SEASON_COMMENT_KEY, {
    text: text.slice(0, 1000),
    generatedAt: new Date().toISOString(),
    label,
  });
  console.log(`[collect-x-buzz] 所感を保存しました (${label}, ${text.length}字)`);
}

/** Mode A: xAI(Grok) の searchAnimeBuzz で作品のバズを導出する。失敗時は null。 */
async function collectXai(title: string): Promise<BuzzRow | null> {
  const buzz = await searchAnimeBuzz(title, [], WINDOW_HOURS);
  if (!buzz) return null;
  // Mode A は answer markdown を持たないため summary/citations は空のまま。
  return {
    volume_score: buzz.post_volume_estimate,
    sentiment: buzz.sentiment,
    topics: buzz.notable_topics,
    quotes: buzz.sample_quotes,
    summary: null,
    citations: [],
  };
}

/** insert に渡す行の形（新カラム summary/citations/episode_id を含む）。 */
interface InsertRow {
  work_id: string;
  window_hours: number;
  volume_score: number;
  sentiment: string | null;
  topics: string[];
  quotes: string[];
  summary: string | null;
  citations: { url: string }[];
  episode_id?: string | null;
}

/**
 * analytics_x_buzz への防御的 insert。
 * まず summary/citations/episode_id を含めて insert を試み、カラム未作成(42703)で
 * 落ちたらこれらを外して再試行する（マイグレーション 0013 適用前でも従来通り動く）。
 * 戻り値は最終的なエラー（成功なら null）。テーブル未作成(42P01)はそのまま返す。
 */
async function insertBuzzRow(
  db: ReturnType<typeof getAdminClient>,
  row: InsertRow,
): Promise<{ code?: string; message?: string } | null> {
  const base = {
    work_id: row.work_id,
    window_hours: row.window_hours,
    volume_score: row.volume_score,
    sentiment: row.sentiment,
    topics: row.topics,
    quotes: row.quotes,
  };
  const full: Record<string, unknown> = {
    ...base,
    summary: row.summary,
    citations: row.citations,
  };
  if (row.episode_id != null) full.episode_id = row.episode_id;

  const { error: insErr } = await db.from("analytics_x_buzz").insert(full);
  if (!insErr) return null;
  if (isMissingTable(insErr)) return insErr;
  if (isMissingColumn(insErr)) {
    // マイグレーション 0013 前: 新カラムを外して再試行（episode 行はそもそも保存不能なのでスキップ）。
    if (row.episode_id != null) return insErr;
    const { error: retryErr } = await db.from("analytics_x_buzz").insert(base);
    return retryErr ?? null;
  }
  return insErr;
}

async function main() {
  const startedAt = new Date().toISOString();
  // Mode B(Hermes) を優先。未設定なら Mode A(XAI) にフォールバック。どちらも無ければ exit 0。
  const hermes = isHermesConfigured();
  const collect = hermes ? collectHermes : collectXai;
  const mode = hermes ? "Hermes" : "XAI";
  // 各呼び出し間のスリープ（Hermes は 30s+ のレイテンシがあるので 1s で十分）。
  const interCallSleepMs = hermes ? 1000 : 2000;

  if (!hermes && !isXaiConfigured()) {
    console.log("Hermes も XAI も未設定のためスキップします");
    process.exit(0);
  }

  const limit = Number(process.env.X_BUZZ_LIMIT) || 12;
  const db = getAdminClient();
  const { year, season } = seasonOf(new Date());

  // 今期の放送中TV作品を人気順に取得
  const { data: works, error: selErr } = await db
    .from("works")
    .select("id, title")
    .eq("season_year", year)
    .eq("season_name", season)
    .eq("status", "airing")
    .eq("media", "tv")
    .order("popularity", { ascending: false })
    .limit(limit);

  if (selErr) {
    console.error("[collect-x-buzz] works の取得に失敗:", selErr);
    process.exit(1);
  }
  const targets = works ?? [];
  console.log(
    `[collect-x-buzz] mode=${mode} 対象作品: ${targets.length} 件（${year}-${season} airing tv）`,
  );

  let inserted = 0;
  let skipped = 0;
  let errors = 0;
  let postsHarvested = 0;

  for (const w of targets) {
    try {
      const buzz = await collect(w.title);
      if (!buzz) {
        skipped++;
        console.log(`[collect-x-buzz] skip(no result): ${w.title}`);
        await sleep(interCallSleepMs);
        continue;
      }

      const insErr = await insertBuzzRow(db, {
        work_id: w.id,
        window_hours: WINDOW_HOURS,
        volume_score: buzz.volume_score,
        sentiment: buzz.sentiment,
        topics: buzz.topics,
        quotes: buzz.quotes,
        summary: buzz.summary,
        citations: buzz.citations,
      });

      if (insErr) {
        if (isMissingTable(insErr)) {
          console.error(
            "[collect-x-buzz] analytics_x_buzz テーブルが存在しません。0012_x_buzz.sql を適用してください。中止します。",
          );
          break;
        }
        errors++;
        console.error(`[collect-x-buzz] insert 失敗: ${w.title}`, insErr);
      } else {
        inserted++;
        console.log(`[collect-x-buzz] ok: ${w.title} volume=${buzz.volume_score}`);
      }

      // 生ポストの harvest（Mode B のみ raw が乗る。テーブル未作成なら穏当にスキップ）。
      if (buzz.rawAnswer != null) {
        postsHarvested += await harvestPosts(
          db,
          w.id,
          null,
          buzz.rawAnswer,
          buzz.rawCitations ?? [],
        );
      }
    } catch (e) {
      errors++;
      console.error(`[collect-x-buzz] 例外: ${w.title}`, e);
    }
    await sleep(interCallSleepMs);
  }

  // 話数別の視聴者反応パス（Mode B = Hermes のみ。answer markdown が必要なため）。
  if (hermes) {
    try {
      await collectEpisodeBuzz(db);
    } catch (e) {
      console.error("[collect-x-buzz] 話数別パスで例外:", e);
    }
    // 今期全体の「所感」コメント（x_search を1クエリだけ使う。メイン分析画面用）。
    try {
      await generateSeasonComment(year, season);
    } catch (e) {
      console.error("[collect-x-buzz] 所感生成で例外:", e);
    }
  }

  console.log(
    `[collect-x-buzz] done: mode=${mode} inserted=${inserted} skipped=${skipped} errors=${errors} targets=${targets.length} posts harvested=${postsHarvested}`,
  );

  try {
    await db.from("sync_runs").insert({
      started_at: startedAt,
      finished_at: new Date().toISOString(),
      status: errors === 0 ? "ok" : "partial",
      created_count: inserted,
      updated_count: skipped,
      error_count: errors,
      note: `collect-x-buzz mode=${mode} inserted=${inserted} targets=${targets.length} posts=${postsHarvested}`,
    });
  } catch {
    /* sync_runs 記録の失敗はジョブ本体に影響させない */
  }

  process.exit(0);
}

/**
 * 話数別の視聴者反応を収集する（Mode B 専用）。
 * 直近(now-48h〜now-30min)に放送が終わった「放送中作品の本放送回」を episode_id 単位で集め、
 * 各話について Hermes に最新話の反応を問い合わせて 1 行（episode_id 付き）を insert する。
 * 直近7日以内に同じ episode_id の行があればスキップ（毎ラン同じ話を問い合わせない）。
 */
async function collectEpisodeBuzz(db: ReturnType<typeof getAdminClient>): Promise<void> {
  const epLimit = Number(process.env.X_EPISODE_BUZZ_LIMIT) || 8;
  const now = Date.now();
  const lowerIso = new Date(now - 48 * 3600 * 1000).toISOString();
  const upperIso = new Date(now - 30 * 60 * 1000).toISOString();

  // 直近に放送終了した、放送中作品の本放送回（episode_id 付き）を取得。
  const { data: progs, error: progErr } = await db
    .from("programs")
    .select(
      "work_id, episode_id, end_at, works!inner(title, status), episodes(number, number_text, title)",
    )
    .eq("is_rebroadcast", false)
    .eq("works.status", "airing")
    .not("episode_id", "is", null)
    .gte("end_at", lowerIso)
    .lte("end_at", upperIso)
    .order("end_at", { ascending: false })
    .limit(500);

  if (progErr) {
    // テーブル/カラム未作成や join 失敗等は穏当にスキップ（cron を落とさない）。
    console.warn("[collect-x-buzz] 話数別: programs 取得をスキップ:", progErr.message ?? progErr);
    return;
  }

  // episode_id でデデュープ（複数チャンネルで同一話が複数番組になりうる）。
  const byEp = new Map<
    string,
    { workId: string; workTitle: string; epLabel: string; subtitle: string }
  >();
  for (const p of progs ?? []) {
    const epId = (p as { episode_id?: string | null }).episode_id;
    const workId = (p as { work_id?: string | null }).work_id;
    if (!epId || !workId || byEp.has(epId)) continue;
    const work = (p as { works?: { title?: string } }).works;
    const ep = (p as {
      episodes?: { number?: number | null; number_text?: string | null; title?: string | null };
    }).episodes;
    const workTitle = work?.title ?? "";
    if (!workTitle) continue;
    const epLabel =
      ep?.number_text ?? (ep?.number != null ? `第${ep.number}話` : "最新話");
    const subtitle = ep?.title ? `「${ep.title}」` : "";
    byEp.set(epId, { workId, workTitle, epLabel, subtitle });
  }

  if (byEp.size === 0) {
    console.log("[collect-x-buzz] 話数別: 対象なし");
    return;
  }

  // 直近7日以内に既に行のある episode_id を除外（再問い合わせ防止）。新カラム未作成なら全件対象。
  const sevenDaysIso = new Date(now - 7 * 24 * 3600 * 1000).toISOString();
  const epIds = [...byEp.keys()];
  try {
    const existing = new Set<string>();
    for (let from = 0; from < epIds.length; from += 100) {
      const slice = epIds.slice(from, from + 100);
      const { data, error } = await db
        .from("analytics_x_buzz")
        .select("episode_id")
        .in("episode_id", slice)
        .gt("captured_at", sevenDaysIso);
      if (error) {
        if (isMissingColumn(error) || isMissingTable(error)) break; // マイグレーション前 → 除外なし
        break;
      }
      for (const r of data ?? []) {
        const id = (r as { episode_id?: string | null }).episode_id;
        if (id) existing.add(id);
      }
    }
    for (const id of existing) byEp.delete(id);
  } catch {
    /* 除外できなくても致命的でない（最悪、重複問い合わせになるだけ） */
  }

  const candidates = [...byEp.entries()].slice(0, epLimit);
  let epInserted = 0;
  let epSkipped = 0;
  let epErrors = 0;
  let epPostsHarvested = 0;

  for (const [episodeId, info] of candidates) {
    try {
      const query =
        `アニメ『${info.workTitle}』の『${info.epLabel}${info.subtitle}』（最新話）について` +
        `X上の視聴者の評価・反応を検索して要約してください。` +
        `最後に必ず1行 BUZZ_JSON: {"volume":0..5,"sentiment":"positive|mixed|negative",` +
        `"topics":["…"],"quotes":["実際のポストの短い引用…"]} を出力。` +
        POSTS_PROMPT_SUFFIX;
      const res = await hermesXSearch(query);
      if (!res) {
        epSkipped++;
        await sleep(1000);
        continue;
      }
      const buzz = buzzFromAnswer(info.workTitle, res.answer, res.citations.length);
      const insErr = await insertBuzzRow(db, {
        work_id: info.workId,
        window_hours: 48,
        volume_score: buzz.volume_score,
        sentiment: buzz.sentiment,
        topics: buzz.topics,
        quotes: buzz.quotes,
        summary: res.answer ? res.answer.trim().slice(0, SUMMARY_MAX) : null,
        citations: dedupCitations(res.citations),
        episode_id: episodeId,
      });
      if (insErr) {
        if (isMissingTable(insErr) || isMissingColumn(insErr)) {
          console.warn(
            "[collect-x-buzz] 話数別: 新カラム/テーブル未作成のため中止（0013_x_buzz_ext.sql 適用前）",
          );
          break;
        }
        epErrors++;
        console.error(`[collect-x-buzz] 話数別 insert 失敗: ${info.workTitle} ${info.epLabel}`, insErr);
      } else {
        epInserted++;
        console.log(
          `[collect-x-buzz] 話数別 ok: ${info.workTitle} ${info.epLabel} volume=${buzz.volume_score}`,
        );
      }

      // 話数レベルの生ポスト harvest（episode_id 付き。テーブル未作成なら穏当にスキップ）。
      epPostsHarvested += await harvestPosts(
        db,
        info.workId,
        episodeId,
        res.answer,
        res.citations,
      );
    } catch (e) {
      epErrors++;
      console.error(`[collect-x-buzz] 話数別 例外: ${info.workTitle} ${info.epLabel}`, e);
    }
    await sleep(1000);
  }

  console.log(
    `[collect-x-buzz] 話数別 done: episodes inserted=${epInserted} skipped=${epSkipped} errors=${epErrors} candidates=${candidates.length} posts harvested=${epPostsHarvested}`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
