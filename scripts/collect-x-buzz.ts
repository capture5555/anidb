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
import { seasonOf } from "../lib/season.ts";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** テーブル未作成(42P01)エラーの検出（マイグレーション前を穏当に扱う） */
function isMissingTable(error: unknown): boolean {
  const e = error as { code?: string; message?: string } | null;
  if (!e) return false;
  return e.code === "42P01" || /analytics_x_buzz.*does not exist/i.test(e.message ?? "");
}

const WINDOW_HOURS = 24;

interface BuzzRow {
  volume_score: number;
  sentiment: string | null;
  topics: string[];
  quotes: string[];
}

/** Mode B: Hermes(x_search_tool) で作品のバズを導出する。失敗時は null。 */
async function collectHermes(title: string): Promise<BuzzRow | null> {
  const query =
    `アニメ『${title}』に関する直近24時間のX上の反応を検索して要約してください。` +
    `最後に必ず1行で BUZZ_JSON: {"volume":0..5,"sentiment":"positive|mixed|negative",` +
    `"topics":["…"],"quotes":["…"]} を出力してください` +
    `（volumeは投稿量の体感: 0=ほぼ無し,5=トレンド級）。`;
  const res = await hermesXSearch(query);
  if (!res) return null;
  return buzzFromAnswer(title, res.answer, res.citations.length);
}

/** Mode A: xAI(Grok) の searchAnimeBuzz で作品のバズを導出する。失敗時は null。 */
async function collectXai(title: string): Promise<BuzzRow | null> {
  const buzz = await searchAnimeBuzz(title, [], WINDOW_HOURS);
  if (!buzz) return null;
  return {
    volume_score: buzz.post_volume_estimate,
    sentiment: buzz.sentiment,
    topics: buzz.notable_topics,
    quotes: buzz.sample_quotes,
  };
}

async function main() {
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

  for (const w of targets) {
    try {
      const buzz = await collect(w.title);
      if (!buzz) {
        skipped++;
        console.log(`[collect-x-buzz] skip(no result): ${w.title}`);
        await sleep(interCallSleepMs);
        continue;
      }

      const { error: insErr } = await db.from("analytics_x_buzz").insert({
        work_id: w.id,
        window_hours: WINDOW_HOURS,
        volume_score: buzz.volume_score,
        sentiment: buzz.sentiment,
        topics: buzz.topics,
        quotes: buzz.quotes,
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
    } catch (e) {
      errors++;
      console.error(`[collect-x-buzz] 例外: ${w.title}`, e);
    }
    await sleep(interCallSleepMs);
  }

  console.log(
    `[collect-x-buzz] done: mode=${mode} inserted=${inserted} skipped=${skipped} errors=${errors} targets=${targets.length}`,
  );
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
