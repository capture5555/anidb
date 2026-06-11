/**
 * 解析スナップショットの事前計算 CLI（GitHub Actions cron から30分おきに実行）。
 *   npm run compute-snapshots
 * 必要env: NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY
 *
 * 役割: 重い全件集計（クール診断・スタジオ/人材スコアカード・ジャンル動向・視聴分析など）の
 * LIVE 計算を「リクエスト経路の外」で走らせ、結果を analytics_snapshots テーブルに保存する。
 * ページ側はこのスナップショットを読むだけになり、高速化する（fromSnapshotOrLive）。
 *
 * 堅牢性: 各計算は try/catch で個別に隔離し、1つが失敗しても残りは続行する。
 * 冪等（upsert）なので何度実行してもよい。
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

import { writeSnapshot } from "../lib/analytics/snapshots.ts";
import { getCoolScorecardUncached } from "../lib/analytics/scorecard.ts";
import { getStudioScorecardsUncached } from "../lib/analytics/studios.ts";
import {
  getVoiceActorScorecardsUncached,
  getStaffScorecardsUncached,
} from "../lib/analytics/people.ts";
import { getGenreInsightsUncached } from "../lib/analytics/genres.ts";
import { getFranchiseMomentumUncached } from "../lib/analytics/franchise.ts";
import { getCohortReactionAverageUncached } from "../lib/analytics/reactionFingerprint.ts";
import { getTimeslotHeatmapUncached } from "../lib/analytics/timeslots.ts";
import {
  getReactionRatiosLive,
  getJikkyoRetentionSeriesLive,
  getPeakMomentsLive,
  getRetentionSeriesLive,
} from "../lib/analytics/viewing.ts";
import { getCohortXBuzzForSnapshot } from "../lib/analytics/xbuzz.ts";

/**
 * 計算ユニット: key と「ページが使うデフォルト引数での LIVE 計算」のペア。
 * compute は必ずスナップショット/メモ化を経由しない素の集計を呼ぶ。
 */
interface Unit {
  key: string;
  compute: () => Promise<unknown>;
  /** 結果の件数を log に出すための任意のカウント関数 */
  count?: (r: any) => number;
}

const UNITS: Unit[] = [
  { key: "cool_scorecard", compute: getCoolScorecardUncached, count: (r) => r?.works?.length ?? 0 },
  { key: "studio_scorecards", compute: () => getStudioScorecardsUncached(), count: (r) => r?.length ?? 0 },
  { key: "va_scorecards", compute: () => getVoiceActorScorecardsUncached(), count: (r) => r?.length ?? 0 },
  { key: "staff_scorecards", compute: () => getStaffScorecardsUncached(), count: (r) => r?.length ?? 0 },
  { key: "genre_insights", compute: getGenreInsightsUncached, count: (r) => r?.length ?? 0 },
  { key: "franchise_momentum", compute: getFranchiseMomentumUncached, count: (r) => r?.length ?? 0 },
  { key: "cohort_reaction", compute: getCohortReactionAverageUncached, count: (r) => r?.basis ?? 0 },
  { key: "reaction_ratios", compute: () => getReactionRatiosLive(1000), count: (r) => r?.length ?? 0 },
  { key: "jikkyo_retention", compute: () => getJikkyoRetentionSeriesLive(8), count: (r) => r?.series?.length ?? 0 },
  { key: "peak_moments", compute: () => getPeakMomentsLive(10), count: (r) => r?.length ?? 0 },
  { key: "annict_retention", compute: () => getRetentionSeriesLive(8), count: (r) => r?.series?.length ?? 0 },
  { key: "timeslot_heatmap", compute: getTimeslotHeatmapUncached, count: (r) => r?.cells?.length ?? 0 },
  { key: "x_cohort_buzz", compute: () => getCohortXBuzzForSnapshot(20), count: (r) => r?.length ?? 0 },
];

/** 1ユニットを計算→保存。失敗しても throw せず結果オブジェクトを返す。 */
async function runUnit(u: Unit): Promise<{ key: string; ok: boolean; count?: number; error?: string }> {
  try {
    const result = await u.compute();
    await writeSnapshot(u.key, result);
    const count = u.count ? u.count(result) : undefined;
    console.log(`ok   ${u.key}${count != null ? ` (count=${count})` : ""}`);
    return { key: u.key, ok: true, count };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`FAIL ${u.key}: ${msg}`);
    return { key: u.key, ok: false, error: msg };
  }
}

async function main() {
  // 全ユニットを並列実行（互いに独立。各々が個別に try/catch される）。
  const results = await Promise.all(UNITS.map(runUnit));
  const ok = results.filter((r) => r.ok).length;
  const failed = results.filter((r) => !r.ok);
  console.log(`compute-snapshots done: ${ok}/${results.length} succeeded` +
    (failed.length ? `, failed=[${failed.map((f) => f.key).join(", ")}]` : ""));
  // 1つでも成功していれば 0、全滅のときだけ 1（部分失敗で cron を赤くしない）。
  process.exit(ok > 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
