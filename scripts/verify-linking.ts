/**
 * 【データ源の事前検証スクリプト】
 * Annict だけで「正確な放送日時・放送局・話数・サブタイトル」が取れるかを確認する。
 * （当初はしょぼいカレンダーとの紐付けを検証していたが、Annictの programs が
 *   startedAt/channel/episode を直接持つことが判明したため、Annict単体の網羅度を測る。）
 *
 * 使い方:
 *   1) .env.local に ANNICT_TOKEN を設定（Supabaseは不要）
 *   2) npm run verify-linking            # 今シーズン
 *      npm run verify-linking -- 2026-spring
 */
import { fetchWorksBySeason } from "../lib/adapters/annict.ts";
import { seasonOf, seasonSlug } from "../lib/season.ts";
import { readFileSync } from "node:fs";

// .env.local を手動ロード
try {
  const env = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
  for (const line of env.split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
} catch {
  /* 環境変数があれば動く */
}

function pad(s: string, n: number) {
  let w = 0;
  for (const ch of s) w += ch.charCodeAt(0) > 0xff ? 2 : 1;
  return s + " ".repeat(Math.max(0, n - w));
}

function toJst(iso: string): string {
  return new Date(iso)
    .toLocaleString("ja-JP", {
      timeZone: "Asia/Tokyo",
      month: "numeric",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      weekday: "short",
    });
}

async function main() {
  if (!process.env.ANNICT_TOKEN) {
    console.error("✗ ANNICT_TOKEN が未設定です。.env.local に設定してください。");
    process.exit(1);
  }

  const season =
    process.argv[2] ??
    (() => {
      const c = seasonOf(new Date());
      return seasonSlug(c.year, c.season);
    })();

  console.log(`\n■ データ源検証（Annict単体）: シーズン = ${season}\n`);
  const works = await fetchWorksBySeason(season);
  console.log(`Annictから ${works.length} 作品を取得\n`);

  let withPrograms = 0;
  let withImage = 0;
  let withCast = 0;
  let subSum = 0;
  let subCounted = 0;

  console.log(pad("作品", 26) + pad("放送回", 7) + pad("画像", 5) + pad("ｻﾌﾞﾀｲﾄﾙ", 9) + "直近の放送");
  console.log("-".repeat(82));

  for (const w of works.slice(0, 30)) {
    const main = w.programs.filter((p) => !p.rebroadcast && p.startedAt);
    if (main.length) withPrograms++;
    if (w.imageUrl) withImage++;
    if (w.casts.length) withCast++;

    let nextAir = "—";
    if (main.length) {
      const future = main
        .filter((p) => new Date(p.startedAt!).getTime() >= Date.now())
        .sort((a, b) => a.startedAt!.localeCompare(b.startedAt!))[0];
      const s = future ?? main.sort((a, b) => a.startedAt!.localeCompare(b.startedAt!))[0];
      nextAir = `${toJst(s.startedAt!)} ${s.channelName ?? ""}`;
      const withSub = main.filter((p) => p.episodeTitle).length;
      const cov = Math.round((withSub / main.length) * 100);
      subSum += cov;
      subCounted++;
    }

    console.log(
      pad(w.title.slice(0, 12), 26) +
        pad(main.length ? String(main.length) : "—", 7) +
        pad(w.imageUrl ? "✓" : "—", 5) +
        pad(main.length ? `${Math.round((main.filter((p) => p.episodeTitle).length / main.length) * 100)}%` : "—", 9) +
        nextAir,
    );
  }

  const n = Math.min(works.length, 30);
  console.log("\n" + "=".repeat(82));
  console.log(`検証作品数              : ${n}`);
  console.log(`放送日時あり            : ${withPrograms} (${Math.round((withPrograms / n) * 100)}%)`);
  console.log(`キービジュアル画像あり  : ${withImage} (${Math.round((withImage / n) * 100)}%)`);
  console.log(`キャスト情報あり        : ${withCast} (${Math.round((withCast / n) * 100)}%)`);
  if (subCounted) console.log(`サブタイトル平均カバー  : ${Math.round(subSum / subCounted)}%`);
  console.log("=".repeat(82));
  console.log(
    withPrograms / n >= 0.7
      ? "\n✓ Annict単体で放送スケジュールを十分取得できます。本番化を進めてOKです。"
      : "\n△ 放送日時の網羅がやや低め。シーズンや時期により変動します（放送開始前は未確定なことも）。",
  );
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error("\n✗ エラー:", e);
    process.exit(1);
  },
);
