/**
 * X(Twitter) のアニメ「バズ」状況を xAI(Grok) の x_search で収集する CLI（GitHub Actions cron）。
 *   npm run collect-x-buzz
 * 必要env: NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY
 *           ＋ XAI_API_KEY もしくは (XAI_REFRESH_TOKEN + XAI_OAUTH_CLIENT_ID)
 *
 * 動作:
 *   - XAI 未設定なら何もせず exit 0（cronを失敗扱いにしない）。
 *   - 今期(現シーズン)の放送中(airing)TV作品を popularity 降順で X_BUZZ_LIMIT(既定15)件取得。
 *   - 各作品について searchAnimeBuzz(title, [], 24) を呼び、analytics_x_buzz に1行 insert。
 *   - 作品ごとに try/catch。テーブル未作成(マイグレーション前)なら気づいて穏当に停止。
 *   - サブスクのクォータ配慮で各呼び出し間に2秒スリープ。
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
import { seasonOf } from "../lib/season.ts";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** テーブル未作成(42P01)エラーの検出（マイグレーション前を穏当に扱う） */
function isMissingTable(error: unknown): boolean {
  const e = error as { code?: string; message?: string } | null;
  if (!e) return false;
  return e.code === "42P01" || /analytics_x_buzz.*does not exist/i.test(e.message ?? "");
}

const WINDOW_HOURS = 24;

async function main() {
  if (!isXaiConfigured()) {
    console.log("XAI not configured, skipping");
    process.exit(0);
  }

  const limit = Number(process.env.X_BUZZ_LIMIT) || 15;
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
  console.log(`[collect-x-buzz] 対象作品: ${targets.length} 件（${year}-${season} airing tv）`);

  let inserted = 0;
  let skipped = 0;
  let errors = 0;

  for (const w of targets) {
    try {
      const buzz = await searchAnimeBuzz(w.title, [], WINDOW_HOURS);
      if (!buzz) {
        skipped++;
        console.log(`[collect-x-buzz] skip(no result): ${w.title}`);
        await sleep(2000);
        continue;
      }

      const { error: insErr } = await db.from("analytics_x_buzz").insert({
        work_id: w.id,
        window_hours: WINDOW_HOURS,
        volume_score: buzz.post_volume_estimate,
        sentiment: buzz.sentiment,
        topics: buzz.notable_topics,
        quotes: buzz.sample_quotes,
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
        console.log(`[collect-x-buzz] ok: ${w.title} volume=${buzz.post_volume_estimate}`);
      }
    } catch (e) {
      errors++;
      console.error(`[collect-x-buzz] 例外: ${w.title}`, e);
    }
    await sleep(2000); // サブスククォータ配慮
  }

  console.log(
    `[collect-x-buzz] done: inserted=${inserted} skipped=${skipped} errors=${errors} targets=${targets.length}`,
  );
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
