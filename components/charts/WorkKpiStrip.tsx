/**
 * WorkKpiStrip — 作品詳細分析ページ上部の KPI カードストリップ（サーバーコンポーネント）。
 *
 * 業界実務者が一目で要点を掴めるよう、主要 6 指標を横並びで表示する。
 * 値が無い KPI はカードを出さない（防御的）。
 *
 * KPI 一覧:
 *   ① 総合スコア  — OverallRankingRow.score + クール内順位
 *   ② 初速スコア  — FastStartRow.score + クール内順位
 *   ③ X バズ      — WorkXBuzz.volume（0〜5）+ sentiment
 *   ④ 満足度      — analysis.satisfactionPoints の最新話 rate
 *   ⑤ 実況コメント — analysis.episodes の Σ totalComments
 *   ⑥ クール内偏差値 — WorkCohortPosition.work.overall + cohort 内順位
 */

import type { WorkAnalysis } from "@/lib/analytics/viewing";
import type { WorkXBuzz } from "@/lib/analytics/xbuzz";
import type { OverallRankingRow } from "@/lib/analytics/overallRanking";
import type { FastStartRow } from "@/lib/analytics/fastStart";
import type { WorkCohortPosition } from "@/lib/analytics/scorecard";

export interface WorkKpiStripProps {
  analysis: WorkAnalysis;
  cohort: WorkCohortPosition | null;
  xbuzz: WorkXBuzz | null;
  overallRow: OverallRankingRow | null;
  fastStartRow: FastStartRow | null;
  /** 総合ランキング内のこの作品の順位（1-indexed, null=不明） */
  overallRank: number | null;
  /** 総合ランキングの母数 */
  overallTotal: number | null;
  /** 初速ランキング内のこの作品の順位（1-indexed, null=不明） */
  fastStartRank: number | null;
  /** 初速ランキングの母数 */
  fastStartTotal: number | null;
}

// ---------------------------------------------------------------- helpers

function fmtNum(n: number): string {
  if (n >= 10000) return `${Math.round(n / 1000)}k`;
  if (n >= 1000) return n.toLocaleString("ja-JP");
  return String(n);
}

function sentimentLabel(s: string | null | undefined): string | null {
  if (!s) return null;
  const lower = s.toLowerCase();
  if (lower.includes("positive") || lower.includes("ポジティブ")) return "好意的";
  if (lower.includes("negative") || lower.includes("ネガティブ")) return "批判的";
  if (lower.includes("neutral") || lower.includes("中立")) return "中立";
  return null;
}

/** dev(偏差値) に応じた強調色を返す */
function devColor(dev: number): string {
  if (dev >= 62) return "text-accent";
  if (dev >= 50) return "text-ink";
  return "text-ink-soft";
}

/** score(0-100) に応じた強調色を返す */
function scoreColor(score: number): string {
  if (score >= 70) return "text-accent";
  if (score >= 50) return "text-ink";
  return "text-ink-soft";
}

// ---------------------------------------------------------------- sub-components

interface KpiCardProps {
  label: string;
  /** メインの大きな数値テキスト */
  value: string;
  /** 単位（数値の後ろにインライン表示） */
  unit?: string;
  /** 副テキスト（順位 / 偏差値 / sentiment etc） */
  sub?: string | null;
  /** オプショナルなインジケーターバー（0〜100） */
  barValue?: number | null;
  /** 数値の色クラス */
  valueColor?: string;
}

function KpiCard({ label, value, unit, sub, barValue, valueColor = "text-ink" }: KpiCardProps) {
  return (
    <div className="card px-3 py-3 flex flex-col gap-1 min-w-0">
      <p className="text-[0.65rem] font-bold text-muted uppercase tracking-wide leading-none truncate">
        {label}
      </p>
      <p className={`tabular-nums font-black leading-none mt-0.5 ${valueColor}`}>
        <span className="text-2xl">{value}</span>
        {unit && <span className="text-xs font-semibold text-muted ml-0.5">{unit}</span>}
      </p>
      {sub && (
        <p className="text-[0.68rem] text-ink-soft tabular-nums leading-none">{sub}</p>
      )}
      {barValue != null && (
        <div className="mt-1 h-1 rounded-full bg-surface-alt overflow-hidden">
          <div
            className="h-full rounded-full bg-accent opacity-70"
            style={{ width: `${Math.max(2, Math.min(100, barValue))}%` }}
          />
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- main

export function WorkKpiStrip({
  analysis,
  cohort,
  xbuzz,
  overallRow,
  fastStartRow,
  overallRank,
  overallTotal,
  fastStartRank,
  fastStartTotal,
}: WorkKpiStripProps) {
  const cards: React.ReactElement[] = [];

  // ① 総合スコア
  if (overallRow != null) {
    const rankText =
      overallRank != null && overallTotal != null
        ? `${overallTotal}作品中 ${overallRank}位`
        : null;
    cards.push(
      <KpiCard
        key="overall"
        label="総合スコア"
        value={overallRow.score.toFixed(0)}
        unit="pt"
        sub={rankText}
        barValue={overallRow.score}
        valueColor={scoreColor(overallRow.score)}
      />,
    );
  }

  // ② 初速スコア
  if (fastStartRow != null) {
    const rankText =
      fastStartRank != null && fastStartTotal != null
        ? `${fastStartTotal}作品中 ${fastStartRank}位`
        : null;
    cards.push(
      <KpiCard
        key="faststart"
        label="初速スコア"
        value={fastStartRow.score.toFixed(0)}
        unit="pt"
        sub={rankText ?? `1話 ${fmtNum(fastStartRow.ep1Comments)}コメ`}
        barValue={fastStartRow.score}
        valueColor={scoreColor(fastStartRow.score)}
      />,
    );
  }

  // ③ X バズ
  if (xbuzz != null) {
    const volDisplay = xbuzz.volume.toFixed(1);
    const sentLabel = sentimentLabel(xbuzz.sentiment);
    cards.push(
      <KpiCard
        key="xbuzz"
        label="X バズ"
        value={volDisplay}
        unit="/ 5"
        sub={sentLabel}
        barValue={(xbuzz.volume / 5) * 100}
        valueColor={xbuzz.volume >= 3.5 ? "text-accent" : xbuzz.volume >= 2 ? "text-ink" : "text-ink-soft"}
      />,
    );
  }

  // ④ 満足度（satisfactionPoints の最新話の rate）
  const latestSat =
    analysis.satisfactionPoints.length > 0
      ? analysis.satisfactionPoints[analysis.satisfactionPoints.length - 1]
      : null;
  if (latestSat != null) {
    const epLabel = latestSat.numberText
      ? `第${latestSat.numberText}話`
      : `第${latestSat.episodeNumber}話`;
    cards.push(
      <KpiCard
        key="satisfaction"
        label="最新話 満足度"
        value={latestSat.rate.toFixed(0)}
        unit="%"
        sub={epLabel}
        barValue={latestSat.rate}
        valueColor={latestSat.rate >= 70 ? "text-accent" : latestSat.rate >= 50 ? "text-ink" : "text-ink-soft"}
      />,
    );
  }

  // ⑤ 実況コメント総数（analysis.episodes の Σ totalComments）
  const totalComments = analysis.episodes.reduce((sum, ep) => sum + ep.totalComments, 0);
  if (totalComments > 0) {
    const epCount = analysis.episodes.length;
    cards.push(
      <KpiCard
        key="jikkyo"
        label="実況コメント"
        value={fmtNum(totalComments)}
        sub={`全${epCount}話合計`}
        valueColor={totalComments >= 50000 ? "text-accent" : "text-ink"}
      />,
    );
  }

  // ⑥ クール内偏差値（cohort.work.overall + overallPercentile）
  if (cohort != null) {
    const dev = cohort.work.overall;
    const pct = cohort.work.overallPercentile;
    cards.push(
      <KpiCard
        key="cohort"
        label="クール内偏差値"
        value={dev.toFixed(0)}
        sub={`上位${pct}% / ${cohort.cohortSize}作品`}
        barValue={Math.min(100, Math.max(0, ((dev - 20) / 60) * 100))}
        valueColor={devColor(dev)}
      />,
    );
  }

  // カードが 1 枚も無ければ何も出さない
  if (cards.length === 0) return null;

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
      {cards}
    </div>
  );
}
