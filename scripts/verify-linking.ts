/**
 * 【最大リスクの早期検証スクリプト】
 * Annict と しょぼいカレンダー が自動で紐付くか（=正確な放送時刻を取得できるか）を確認する。
 *
 * 使い方:
 *   1) .env.local に ANNICT_TOKEN を設定（Supabaseは不要）
 *   2) npm run verify-linking            # 今シーズン
 *      npm run verify-linking -- 2026-spring
 *
 * 出力: 作品ごとに「scPid取得→TID逆引き→放送回取得」が成功したかを表示し、
 *       最後に紐付け成功率をまとめる。ここが高ければ本番化はスムーズ。
 */
import { fetchWorksBySeason } from "../lib/adapters/annict.ts";
import { fetchTidByPid, fetchProgramsByTid } from "../lib/adapters/syoboi.ts";
import { seasonOf, seasonSlug } from "../lib/season.ts";

// .env.local を読む（Next.js外なので手動ロード）
import { readFileSync } from "node:fs";
try {
  const env = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
  for (const line of env.split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
} catch {
  /* .env.local が無くても環境変数があれば動く */
}

function pad(s: string, n: number) {
  // 全角を2幅としてざっくり整形
  let w = 0;
  for (const ch of s) w += ch.charCodeAt(0) > 0xff ? 2 : 1;
  return s + " ".repeat(Math.max(0, n - w));
}

async function main() {
  if (!process.env.ANNICT_TOKEN) {
    console.error("✗ ANNICT_TOKEN が未設定です。.env.local に設定してください。");
    process.exit(1);
  }

  const arg = process.argv[2];
  const season = arg ?? (() => {
    const c = seasonOf(new Date());
    return seasonSlug(c.year, c.season);
  })();

  console.log(`\n■ 紐付け検証: シーズン = ${season}\n`);
  console.log("Annictから作品を取得中…");
  const works = await fetchWorksBySeason(season);
  console.log(`  → ${works.length} 作品\n`);

  let linked = 0;
  let withScpid = 0;
  let totalSubtitleCoverage = 0;
  let counted = 0;

  console.log(pad("作品", 28) + pad("scPid", 8) + pad("TID", 8) + pad("放送回", 8) + "直近の放送");
  console.log("-".repeat(80));

  for (const w of works.slice(0, 25)) {
    const scPid = w.programs.find((p) => p.scPid)?.scPid ?? null;
    if (scPid) withScpid++;

    let tid: number | null = null;
    let progCount = 0;
    let nextAir = "";
    let subtitleCov = "";

    if (scPid) {
      tid = await fetchTidByPid(scPid).catch(() => null);
      if (tid) {
        const programs = await fetchProgramsByTid(tid).catch(() => []);
        progCount = programs.length;
        if (progCount > 0) {
          linked++;
          const future = programs
            .filter((p) => new Date(p.stTime).getTime() >= Date.now())
            .sort((a, b) => a.stTime.localeCompare(b.stTime))[0];
          const sample = future ?? programs[programs.length - 1];
          nextAir = `${sample.stTime.slice(0, 16).replace("T", " ")} ${sample.chName ?? ""}`;
          const withSub = programs.filter((p) => p.subTitle).length;
          const cov = Math.round((withSub / progCount) * 100);
          subtitleCov = `${cov}%`;
          totalSubtitleCoverage += cov;
          counted++;
        }
      }
    }

    console.log(
      pad(w.title.slice(0, 13), 28) +
        pad(scPid ? "✓" : "—", 8) +
        pad(tid ? String(tid) : "—", 8) +
        pad(progCount ? String(progCount) : "—", 8) +
        (nextAir || "(紐付け失敗)") +
        (subtitleCov ? `  [サブタイトル ${subtitleCov}]` : ""),
    );
  }

  const sample = Math.min(works.length, 25);
  console.log("\n" + "=".repeat(80));
  console.log(`検証作品数            : ${sample}`);
  console.log(`scPidあり             : ${withScpid} (${Math.round((withScpid / sample) * 100)}%)`);
  console.log(`しょぼい紐付け成功     : ${linked} (${Math.round((linked / sample) * 100)}%)`);
  if (counted) console.log(`サブタイトル平均カバー : ${Math.round(totalSubtitleCoverage / counted)}%`);
  console.log("=".repeat(80));
  console.log(
    linked / sample >= 0.7
      ? "\n✓ 紐付け率は良好です。本番化を進めて問題ありません。"
      : "\n△ 紐付け率がやや低めです。突合ロジックの調整 or 手動補正(syoboi_tid)の運用を検討してください。",
  );
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error("\n✗ エラー:", e);
    process.exit(1);
  },
);
