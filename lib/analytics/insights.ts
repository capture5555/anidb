/**
 * 自動インサイト生成 — 純関数（DB不要・単体テスト可能）。
 *
 * 既計算の analytics データを受け取り、意思決定向けの日本語インサイト行を返す。
 * データが薄い場合は空配列 / null を返してサイレントに退行する。
 */

import type { CoolScorecard } from "./scorecard";
import type { StudioScorecard } from "./studios";
import type { VaScorecard, StaffScorecard } from "./people";
import type { GenreInsight } from "./genres";
import type { FranchiseGroup } from "./franchise";

/* ----------------------------------------------------------------
   ユーティリティ
   ---------------------------------------------------------------- */

/** 打率を .XXX 形式の文字列に変換する */
function fmtBa(ba: number): string {
  return `.${String(Math.round(ba * 1000)).padStart(3, "0")}`;
}

/** 4象限の作品数をカウントする */
function countQuadrants(works: CoolScorecard["works"]): Record<string, number> {
  const counts: Record<string, number> = {
    royal: 0,
    wordofmouth: 0,
    fastburn: 0,
    niche: 0,
  };
  for (const w of works) {
    counts[w.quadrant] = (counts[w.quadrant] ?? 0) + 1;
  }
  return counts;
}

/* ----------------------------------------------------------------
   seasonSummary
   ---------------------------------------------------------------- */

/**
 * クール診断の自動サマリー（最大5行）。
 * - ①総合トップ作品
 * - ②最も顕著なスリーパー（sleeper && scoreDev - awarenessDev が最大）＋ 具体数値
 * - ③最も顕著な話題先行作品（overhyped && awarenessDev - scoreDev が最大）
 * - ④ダークホース筆頭
 * - ⑤4象限の分布
 * データが薄い場合は空配列を返す。
 */
export function seasonSummary(card: CoolScorecard): string[] {
  const { works } = card;
  if (works.length === 0) return [];

  const lines: string[] = [];

  // ① 総合トップ作品
  const top = works[0];
  lines.push(
    `今クールの総合トップは「${top.title}」（総合偏差値 ${top.overall.toFixed(0)}、上位 ${top.overallPercentile}%）。`,
  );

  // ② 最も顕著なスリーパー（sleeper が true の中で scoreDev - awarenessDev が最大）
  const sleepers = works.filter(
    (w) => w.sleeper && w.scoreDev != null,
  );
  if (sleepers.length > 0) {
    const best = sleepers.reduce((a, b) => {
      const gapA = (a.scoreDev ?? 0) - a.awarenessDev;
      const gapB = (b.scoreDev ?? 0) - b.awarenessDev;
      return gapB > gapA ? b : a;
    });
    const scDev = (best.scoreDev ?? 0).toFixed(0);
    const awDev = best.awarenessDev.toFixed(0);
    lines.push(
      `最も過小評価：「${best.title}」（評価偏差値 ${scDev} / 認知偏差値 ${awDev}）。高評価だが認知が追いついていない＝発掘・先行投資の候補。`,
    );
  }

  // ③ 最も顕著な話題先行作品（overhyped が true の中で awarenessDev - scoreDev が最大）
  const overhypedWorks = works.filter(
    (w) => w.overhyped && w.scoreDev != null,
  );
  if (overhypedWorks.length > 0) {
    const worst = overhypedWorks.reduce((a, b) => {
      const gapA = a.awarenessDev - (a.scoreDev ?? 0);
      const gapB = b.awarenessDev - (b.scoreDev ?? 0);
      return gapB > gapA ? b : a;
    });
    const awDev = worst.awarenessDev.toFixed(0);
    const scDev = (worst.scoreDev ?? 0).toFixed(0);
    lines.push(
      `話題先行筆頭：「${worst.title}」（認知偏差値 ${awDev} / 評価偏差値 ${scDev}）。初速以降の伸びは慎重に見る。`,
    );
  }

  // ④ ダークホース筆頭（darkhorse が最大かつ正）
  const dhWorks = works.filter((w) => w.darkhorse > 0);
  if (dhWorks.length > 0) {
    const topDh = dhWorks.reduce((a, b) => (b.darkhorse > a.darkhorse ? b : a));
    lines.push(
      `ダークホース指数トップは「${topDh.title}」（+${topDh.darkhorse}）：知名度の割に濃く語られている伸びしろ枠。`,
    );
  }

  // ⑤ 4象限の分布
  const qc = countQuadrants(works);
  const total = works.length;
  if (total >= 4) {
    lines.push(
      `象限分布（全 ${total} 作品）：王道ヒット ${qc.royal} 本 / 口コミ型 ${qc.wordofmouth} 本 / 初速一発型 ${qc.fastburn} 本 / ニッチ ${qc.niche} 本。`,
    );
  }

  return lines;
}

/* ----------------------------------------------------------------
   studioInsight
   ---------------------------------------------------------------- */

/**
 * スタジオデータから「打率トップ」と「一貫性トップ」を1行で要約する。
 * 2行未満のデータでは null を返す。
 */
export function studioInsight(rows: StudioScorecard[]): string | null {
  if (rows.length < 2) return null;

  // 打率トップ（NaN/0 を除いて最大）
  const byBa = rows
    .filter((r) => isFinite(r.battingAverage) && r.battingAverage > 0)
    .sort((a, b) => b.battingAverage - a.battingAverage);

  // 一貫性トップ（null を除いて最大）
  const byCon = rows
    .filter((r) => r.consistency != null && isFinite(r.consistency))
    .sort((a, b) => (b.consistency ?? 0) - (a.consistency ?? 0));

  if (byBa.length === 0 && byCon.length === 0) return null;

  const parts: string[] = [];

  if (byBa.length > 0) {
    const top = byBa[0];
    parts.push(`打率トップは${top.studio}（${fmtBa(top.battingAverage)}）`);
  }

  if (byCon.length > 0) {
    const top = byCon[0];
    parts.push(`最も粒ぞろいなのは${top.studio}（一貫性 ${top.consistency}）`);
  }

  if (parts.length === 0) return null;

  return parts.join("。") + "。";
}

/* ----------------------------------------------------------------
   vaInsight
   ---------------------------------------------------------------- */

/**
 * 声優データから「モメンタム最大」と「ブレイク人数」を1行で要約する。
 * モメンタムがある声優がいなければ null を返す。
 */
export function vaInsight(rows: VaScorecard[]): string | null {
  // モメンタム最大（momentum != null かつ最大値）
  const withMomentum = rows.filter((r) => r.momentum != null);
  if (withMomentum.length === 0) return null;

  const topMom = withMomentum.reduce((a, b) =>
    (b.momentum ?? -Infinity) > (a.momentum ?? -Infinity) ? b : a,
  );

  const breakoutCount = rows.filter((r) => r.breakout).length;

  const momSign = (topMom.momentum ?? 0) >= 0 ? "▲+" : "▽";
  const momVal = Math.abs(Math.round((topMom.momentum ?? 0) * 10) / 10).toFixed(1);

  const breakoutPart =
    breakoutCount > 0
      ? `。直近1年にブレイク認定を受けた声優は ${breakoutCount} 名`
      : "";

  return `モメンタムトップは${topMom.name}（${momSign}${momVal}）${breakoutPart}。`;
}

/* ----------------------------------------------------------------
   genreOpportunity
   ---------------------------------------------------------------- */

/**
 * 「需要（平均人気）が高いのに作品数が少ない」ジャンルを1つ指摘する。
 * worksCount >= 2 のジャンルを対象に、avgPopularity の上位25%に入るが
 * worksCount の下位25%に入るものをグリーンライト機会として提示する。
 * 該当なし・データ不足では null を返す。
 */
export function genreOpportunity(rows: GenreInsight[]): string | null {
  // worksCount >= 2 のみ対象
  const eligible = rows.filter((r) => r.worksCount >= 2);
  if (eligible.length < 4) return null;

  // avgPopularity の上位25%閾値
  const sorted = [...eligible].sort((a, b) => b.avgPopularity - a.avgPopularity);
  const popThreshold = sorted[Math.floor(sorted.length * 0.25)].avgPopularity;

  // worksCount の下位25%閾値
  const sortedByCount = [...eligible].sort((a, b) => a.worksCount - b.worksCount);
  const countThreshold = sortedByCount[Math.floor(sortedByCount.length * 0.25)].worksCount;

  // 両条件を満たすもの（人気 >= 上位25%, 作品数 <= 下位25%）
  const candidates = eligible.filter(
    (r) => r.avgPopularity >= popThreshold && r.worksCount <= countThreshold,
  );

  if (candidates.length === 0) return null;

  // 候補の中で avgPopularity が最大のものを選ぶ
  const best = candidates.reduce((a, b) => (b.avgPopularity > a.avgPopularity ? b : a));

  return `グリーンライト機会：「${best.genre}」は平均人気 ${best.avgPopularity.toLocaleString()} と需要が高いが、作品数は ${best.worksCount} 本と少ない。供給余地あり。`;
}

/* ----------------------------------------------------------------
   franchiseInsight
   ---------------------------------------------------------------- */

/**
 * フランチャイズ・モメンタムから「最も伸びているIP」と「縮小傾向のIP数」を1行で要約する。
 * 伸びているIP（popularityTrend != null かつ growing）が無ければ null を返す。
 */
export function franchiseInsight(groups: FranchiseGroup[]): string | null {
  if (!groups || groups.length === 0) return null;

  const growing = groups.filter(
    (g) => g.verdict === "growing" && g.popularityTrend != null,
  );
  if (growing.length === 0) return null;

  // popularityTrend 最大のIP
  const top = growing.reduce((a, b) =>
    (b.popularityTrend ?? 0) > (a.popularityTrend ?? 0) ? b : a,
  );

  const decayingCount = groups.filter((g) => g.verdict === "decaying").length;
  const x = (top.popularityTrend ?? 1).toFixed(1);

  const decayPart =
    decayingCount > 0 ? `一方、縮小傾向のIPは ${decayingCount} 系列。` : "";

  return `最も伸びているIPは「${top.latestTitle}」（系列人気 ${x}倍）。${decayPart}続編greenlight・フランチャイズ投資の判断材料に。`;
}

/* ----------------------------------------------------------------
   compareInsight — 声優比較のワンライン要約
   ---------------------------------------------------------------- */

/**
 * 2〜3名の声優スコアカードを比較し、主演適性・モメンタムを1行で要約する。
 * データ不足（leadAvgScore が全員 null など）のときは null を返す。
 */
export function compareInsight(people: VaScorecard[]): string | null {
  if (people.length < 2) return null;

  // 主演適性: leadAvgScore 最大の人
  const withLead = people.filter((p) => p.leadAvgScore != null);
  const bestLead =
    withLead.length > 0
      ? withLead.reduce((a, b) =>
          (b.leadAvgScore ?? 0) > (a.leadAvgScore ?? 0) ? b : a,
        )
      : null;

  // モメンタム: momentum 最大の人
  const withMom = people.filter((p) => p.momentum != null);
  const bestMom =
    withMom.length > 0
      ? withMom.reduce((a, b) =>
          (b.momentum ?? -Infinity) > (a.momentum ?? -Infinity) ? b : a,
        )
      : null;

  const parts: string[] = [];

  if (bestLead != null) {
    parts.push(
      `主演適性は${bestLead.name}（主演作平均 ${bestLead.leadAvgScore}）`,
    );
  }

  if (bestMom != null && (bestMom.momentum ?? 0) !== 0) {
    const sign = (bestMom.momentum ?? 0) > 0 ? "+" : "";
    const val = Math.round((bestMom.momentum ?? 0) * 10) / 10;
    parts.push(`勢いは${bestMom.name}（モメンタム ${sign}${val}）`);
  }

  if (parts.length === 0) return null;

  return parts.join("、") + "。";
}

/**
 * 2〜3名のスタッフスコアカードを比較し、平均スコア・一貫性を1行で要約する。
 * データ不足のときは null を返す。
 */
export function compareStaffInsight(people: StaffScorecard[]): string | null {
  if (people.length < 2) return null;

  // 平均スコアトップ
  const bestScore = people.reduce((a, b) => (b.avgScore > a.avgScore ? b : a));

  // 一貫性トップ
  const withCon = people.filter((p) => p.consistency != null);
  const bestCon =
    withCon.length > 0
      ? withCon.reduce((a, b) =>
          (b.consistency ?? 0) > (a.consistency ?? 0) ? b : a,
        )
      : null;

  const parts: string[] = [];
  parts.push(`平均スコアトップは${bestScore.name}（${bestScore.avgScore}）`);
  if (bestCon != null && bestCon.name !== bestScore.name) {
    parts.push(`一貫性トップは${bestCon.name}（${bestCon.consistency}）`);
  }

  return parts.join("、") + "。";
}
