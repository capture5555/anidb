/**
 * セクションごとの「ひとことメモ」を作る純関数群。
 *
 * 各分析セクションに1つ、データから機械的に導く短い所感を添えるための文章生成。
 * すべて純関数（DBアクセスなし）で、データが薄いときは null を返す（＝メモ非表示）。
 * 統計に基づく即時コメントなので、Grok等のLLMは使わずルールベースで生成する。
 */
import type { WorkAnalysis, RetentionSeries, PeakMoment, ReactionRatioWork } from "./viewing.ts";
import type { WorkReactionBreakdown } from "./workReactions.ts";
import type { ReactionCategory } from "./commentAnalysis.ts";
import type { CohortXBuzz, XBuzzVsJikkyo, EpisodeBuzzLeader, XTopicLeader, AwarenessHeatRow } from "./xbuzz.ts";
import type { OverallRankingRow } from "./overallRanking.ts";
import type { VaScorecard, StaffScorecard } from "./people.ts";
import type { StudioScorecard } from "./studios.ts";
import type { GenreInsight } from "./genres.ts";
import { genreJa } from "../genres.ts";
import type { RatedWork } from "../analytics.ts";
import type { GlobalGapRow } from "./globalGap.ts";
import type { FastStartRow } from "./fastStart.ts";
import type { RiserRow } from "./risers.ts";
import type { SequelProspectRow } from "./sequelProspect.ts";
import type { TimeslotCompetitionSlot } from "./timeslots.ts";
import { TIMESLOT_WEEKDAYS } from "./timeslots.ts";

const REACTION_LABEL: Record<ReactionCategory, string> = {
  laugh: "笑い",
  hype: "興奮",
  cry: "感動",
  surprise: "驚き",
  sakuga: "作画",
  scream: "絶叫",
};

/** 話数ラベルを短く（「第3話」→「3話」）。 */
function shortEp(label: string): string {
  return label.replace(/^第/, "").trim() || label;
}

/**
 * リアクションの傾向セクションのメモ。
 * 最多カテゴリと、それがどれくらい突出しているかを述べる。
 */
export function reactionSectionComment(reactions: WorkReactionBreakdown | null): string | null {
  if (!reactions || !reactions.dominant) return null;
  const { category, share } = reactions.dominant;
  const label = REACTION_LABEL[category] ?? category;
  const pct = Math.round(share * 100);
  if (pct <= 0) return null;
  // 2番手との差で「色が濃い／バランス型」を判定。
  const sorted = [...reactions.overall].sort((a, b) => b.share - a.share);
  const second = sorted[1]?.share ?? 0;
  const gap = share - second;
  const tone =
    gap >= 0.15
      ? `「${label}」に大きく振れた反応が特徴`
      : `「${label}」を中心にいろいろな反応が混ざるバランス型`;
  return `実況の反応は${tone}（${label}が構成比${pct}%で最多）。`;
}

/**
 * 視聴継続率と満足度セクションのメモ。
 * 実況コメントの最新話残留率と、満足度の平均から所感を述べる。
 */
export function retentionSectionComment(analysis: WorkAnalysis): string | null {
  const eps = analysis.episodes;
  const parts: string[] = [];

  if (eps.length >= 2) {
    const base = eps[0].totalComments;
    const last = eps[eps.length - 1];
    if (base > 0 && last.totalComments > 0) {
      const pct = Math.round((last.totalComments / base) * 100);
      const trend =
        pct >= 90
          ? "ほぼ落ちずに維持"
          : pct >= 60
            ? "緩やかに減少"
            : pct >= 35
              ? "中盤でやや離脱"
              : "序盤から大きく離脱";
      parts.push(`実況コメントは${shortEp(last.episodeLabel)}時点で初回の${pct}%（${trend}）`);
    }
  }

  const sat = analysis.satisfactionPoints.filter((p) => p.rate > 0);
  if (sat.length > 0) {
    const avg = Math.round(sat.reduce((a, p) => a + p.rate, 0) / sat.length);
    const last = sat[sat.length - 1];
    const dir =
      sat.length >= 2 && last.rate - sat[0].rate >= 3
        ? "・終盤にかけて上昇"
        : sat.length >= 2 && sat[0].rate - last.rate >= 3
          ? "・終盤にかけて低下"
          : "";
    parts.push(`満足度は平均${avg}%${dir}`);
  }

  if (parts.length === 0) return null;
  return `${parts.join("。")}。`;
}

/**
 * 放送回ごとの盛り上がりセクションのメモ。
 * 最もコメントが多かった回を指摘する。
 */
export function heatSectionComment(analysis: WorkAnalysis): string | null {
  const eps = analysis.episodes.filter((e) => e.totalComments > 0);
  if (eps.length === 0) return null;
  const top = eps.reduce((best, e) => (e.totalComments > best.totalComments ? e : best), eps[0]);
  const avg = eps.reduce((a, e) => a + e.totalComments, 0) / eps.length;
  if (top.totalComments <= 0 || avg <= 0) return null;
  const ratio = top.totalComments / avg;
  const emphasis = ratio >= 1.6 ? "突出して" : ratio >= 1.2 ? "やや多めに" : "";
  return `最も実況が盛り上がったのは${shortEp(top.episodeLabel)}（${top.totalComments.toLocaleString()}コメント）で、平均より${emphasis}盛り上がっています。`;
}

/**
 * Xバズセクションのメモ。
 * 直近の盛り上がり量(0〜5)とセンチメントから一言。
 */
export function xBuzzSectionComment(
  buzz: { volume: number; sentiment: string | null; topics: string[] } | null,
): string | null {
  if (!buzz) return null;
  const v = Math.max(0, Math.min(5, Math.round(buzz.volume)));
  const heat =
    v >= 4 ? "X上でかなり話題" : v >= 3 ? "X上で着実に話題" : v >= 1 ? "X上の話題は控えめ" : "X上の話題は静か";
  const s = (buzz.sentiment ?? "").toLowerCase();
  const senti =
    s === "positive" ? "・概ね好評" : s === "negative" ? "・厳しめの声も" : s === "mixed" ? "・賛否あり" : "";
  const topic = buzz.topics[0] ? `（注目: ${buzz.topics[0]}）` : "";
  return `${heat}（${v}/5）${senti}${topic}。`;
}

/**
 * 「盛り上がった放送回（直近◯日）」一覧のメモ（分析ハブ用）。
 * 先頭（最多コメント）の回を指摘する。
 */
export function hotProgramsComment(
  items: { workTitle: string; episodeLabel: string | null; totalComments: number }[],
): string | null {
  if (items.length === 0) return null;
  const top = items[0];
  if (top.totalComments <= 0) return null;
  const ep = top.episodeLabel ? ` ${shortEp(top.episodeLabel)}` : "";
  return `直近で最も実況が盛り上がったのは「${top.workTitle}」${ep}（${top.totalComments.toLocaleString()}コメント）。`;
}

/**
 * 放送回ごとの実況の傾向メモ（その回のリアクション内訳＋規模＋瞬間最大から）。
 * 母数が小さい回は null。話数を選んだときに「この回はこういう傾向」を出すのに使う。
 */
export function episodeJikkyoTendency(input: {
  totalComments: number;
  reactionCounts: Partial<Record<ReactionCategory, number>>;
  peakPerMinute?: number;
}): string | null {
  const total = input.totalComments;
  if (total < 5) return null; // 母数が少なすぎる回はメモなし
  const entries = (Object.entries(input.reactionCounts) as [ReactionCategory, number][])
    .filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1]);

  const parts: string[] = [];
  if (entries.length > 0) {
    const top = REACTION_LABEL[entries[0][0]] ?? entries[0][0];
    const second = entries[1] ? `・${REACTION_LABEL[entries[1][0]] ?? entries[1][0]}` : "";
    parts.push(`実況は「${top}${second}」系の反応が中心`);
  }
  if (input.peakPerMinute && input.peakPerMinute >= 100) {
    parts.push("一気に伸びる瞬間（祭り）あり");
  }
  const scale =
    total >= 2000 ? "盛況" : total >= 500 ? "まずまずの賑わい" : "落ち着いた反応";
  parts.push(`全体は${scale}（${total.toLocaleString()}コメント）`);
  return `${parts.join("、")}。`;
}

/* ================================================================
 * 分析ハブ用 追加コメント関数
 * ================================================================ */

/**
 * 話数別視聴継続率セクションのメモ（分析ハブ用）。
 * 最も残留率が安定している作品と最も落ちた作品を対比する。
 */
export function retentionSeriesComment(series: RetentionSeries[]): string | null {
  if (series.length === 0) return null;
  // 最新話残留率（最後のポイント）が確定している系列だけ対象
  const withLast = series
    .map((s) => ({ title: s.title, last: s.points[s.points.length - 1]?.pct ?? null }))
    .filter((s): s is { title: string; last: number } => s.last != null && s.last > 0);
  if (withLast.length === 0) return null;
  if (withLast.length === 1) {
    const only = withLast[0];
    const trend = only.last >= 90 ? "ほぼ落ちずに維持" : only.last >= 60 ? "緩やかに減少" : only.last >= 35 ? "中盤でやや離脱" : "序盤から大きく離脱";
    return `「${only.title}」の残留率は${Math.round(only.last)}%（${trend}）。`;
  }
  const best = withLast.reduce((a, b) => (b.last > a.last ? b : a));
  const worst = withLast.reduce((a, b) => (b.last < a.last ? b : a));
  if (best.title === worst.title) return null;
  return `残留率が最も高いのは「${best.title}」（${Math.round(best.last)}%）、最も落ちているのは「${worst.title}」（${Math.round(worst.last)}%）。`;
}

/**
 * 瞬間最大風速ランキングセクションのメモ（分析ハブ用）。
 * 1位の瞬間とそのコメント密度を述べる。
 */
export function peakMomentsComment(peaks: PeakMoment[]): string | null {
  if (peaks.length === 0) return null;
  const top = peaks[0];
  if (top.maxPerMinute <= 0) return null;
  const ep = top.episodeLabel ? ` ${shortEp(top.episodeLabel)}` : "";
  return `今期の最大瞬間風速は「${top.workTitle}」${ep}（${top.maxPerMinute.toLocaleString()}コメ/分）。`;
}

/**
 * リアクション別ランキングセクションのメモ（分析ハブ用）。
 * 笑い・感動・作画で最も高率だった作品をひとまとめに紹介する。
 */
export function reactionRankingComment(ratios: ReactionRatioWork[]): string | null {
  if (ratios.length === 0) return null;
  const topOf = (cat: "laugh" | "cry" | "sakuga"): { title: string; pct: number } | null => {
    const sorted = ratios
      .filter((w) => (w.ratios[cat] ?? 0) > 0)
      .sort((a, b) => (b.ratios[cat] ?? 0) - (a.ratios[cat] ?? 0));
    if (sorted.length === 0) return null;
    return { title: sorted[0].title, pct: Math.round(sorted[0].ratios[cat] ?? 0) };
  };
  const laugh = topOf("laugh");
  const cry = topOf("cry");
  if (!laugh && !cry) return null;
  const parts: string[] = [];
  if (laugh) parts.push(`笑いは「${laugh.title}」（${laugh.pct}%）`);
  if (cry) parts.push(`感動は「${cry.title}」（${cry.pct}%）`);
  return `${parts.join("、")}がトップ。`;
}

/**
 * クール内Xバズランキングのメモ（分析ハブ用）。
 * 1位の作品とバズ強度、ポジティブ率を述べる。
 */
export function cohortXBuzzComment(cohort: CohortXBuzz[]): string | null {
  if (cohort.length === 0) return null;
  const top = cohort[0];
  const vol = Math.max(0, Math.min(5, Math.round(top.volume)));
  const senti = (top.sentiment ?? "").toLowerCase();
  const sentiNote =
    senti === "positive" ? "・好評" : senti === "negative" ? "・批判的な声も" : senti === "mixed" ? "・賛否あり" : "";
  return `今期Xバズ1位は「${top.title}」（${vol}/5）${sentiNote}。全${cohort.length}作品を追跡中。`;
}

/**
 * ニコ実況×X相関セクションのメモ（分析ハブ用）。
 * 「実況で熱いがXは静か」「Xで話題だが実況は静か」の代表作を指摘する。
 */
export function xBuzzVsJikkyoComment(points: XBuzzVsJikkyo[]): string | null {
  if (points.length === 0) return null;
  const maxJikkyo = Math.max(...points.map((p) => p.jikkyoComments));
  const midJikkyo = maxJikkyo / 2;
  const midVol = 2.5;
  // 右下象限: 実況コメントが多い（>midJikkyo）がXバズが低い（<midVol）
  const jikkyoHot = points.filter((p) => p.jikkyoComments > midJikkyo && p.xVolume < midVol);
  // 左上象限: 実況コメントが少ない（<=midJikkyo）がXバズが高い（>=midVol）
  const xHot = points.filter((p) => p.jikkyoComments <= midJikkyo && p.xVolume >= midVol);
  const parts: string[] = [];
  if (jikkyoHot.length > 0) {
    const rep = jikkyoHot.reduce((a, b) => (b.jikkyoComments > a.jikkyoComments ? b : a));
    parts.push(`実況で熱いがXは静かな作品の代表は「${rep.title}」`);
  }
  if (xHot.length > 0) {
    const rep = xHot.reduce((a, b) => (b.xVolume > a.xVolume ? b : a));
    parts.push(`X上で話題だが実況は静かなのは「${rep.title}」`);
  }
  if (parts.length === 0) return null;
  return `${parts.join("。")}。`;
}

/**
 * 注目の話数セクションのメモ（分析ハブ用）。
 * 1位の話数とトピックを紹介する。
 */
export function epLeadersComment(epLeaders: EpisodeBuzzLeader[]): string | null {
  if (epLeaders.length === 0) return null;
  const top = epLeaders[0];
  const vol = Math.max(0, Math.min(5, Math.round(top.volume)));
  const topic = top.topics[0] ? `「${top.topics[0]}」が話題` : "";
  const ep = top.episodeLabel ? ` ${top.episodeLabel}` : "";
  return `話数別バズ1位は「${top.title}」${ep}（${vol}/5）${topic ? "。" + topic : ""}。`;
}

/**
 * 話題ワードセクションのメモ（分析ハブ用）。
 * 最多出現ワードと複数作品にまたがるワード数を述べる。
 */
export function topicsComment(topics: XTopicLeader[]): string | null {
  if (topics.length === 0) return null;
  const top = topics[0];
  const crossCount = topics.filter((t) => t.count >= 2).length;
  const crossNote = crossCount > 0 ? `複数作品またがりワードが${crossCount}語` : `${topics.length}語が集計中`;
  return `最多話題は「${top.topic}」（${top.count}作品）。${crossNote}。`;
}

/**
 * 総合ランキングセクションのメモ（分析ハブ用）。
 * 1位の作品と、どのシグナルが突出しているかを述べる短文を返す。
 * データが空または1位が確定しない場合は null。
 */
export function overallRankingComment(rows: OverallRankingRow[]): string | null {
  if (rows.length === 0) return null;
  const top = rows[0];

  // 突出しているシグナル（パーセンタイル >= 80）を探す
  const strong: string[] = [];
  const sigs = top.signals;
  if ((sigs.jikkyo ?? 0) >= 80) strong.push("実況");
  if ((sigs.xbuzz ?? 0) >= 80) strong.push("X");
  if ((sigs.awareness ?? 0) >= 80) strong.push("認知");
  if ((sigs.review ?? 0) >= 80) strong.push("批評");
  if ((sigs.retention ?? 0) >= 80) strong.push("継続/満足");

  const scoreNote = `（総合スコア ${top.score.toFixed(0)}点）`;

  if (strong.length >= 2) {
    return `総合1位は『${top.title}』${scoreNote}。${strong.join("と")}の両方で突出。`;
  }
  if (strong.length === 1) {
    return `総合1位は『${top.title}』${scoreNote}。特に${strong[0]}シグナルが強い。`;
  }
  return `総合1位は『${top.title}』${scoreNote}。複数シグナルをバランスよく積み上げた。`;
}

/* ================================================================
 * 人材タブ・業界データタブ追加コメント関数
 * ================================================================ */

/**
 * 声優スコアカードのひとことメモ。
 * ブレイク声優数・平均打率の傾向を述べる。
 */
export function vaScorecardComment(rows: VaScorecard[]): string | null {
  if (rows.length === 0) return null;
  const breakouts = rows.filter((r) => r.breakout).length;
  const withBa = rows.filter((r) => isFinite(r.battingAverage) && r.battingAverage > 0);
  if (withBa.length === 0) return null;
  const avgBa = withBa.reduce((a, b) => a + b.battingAverage, 0) / withBa.length;
  const baStr = `.${String(Math.round(avgBa * 1000)).padStart(3, "0")}`;
  const top = rows[0];
  const parts: string[] = [];
  parts.push(`主演スコア1位は${top.name}（平均${top.leadAvgScore != null ? Math.round(top.leadAvgScore) : "—"}点）`);
  if (breakouts > 0) parts.push(`ブレイク声優${breakouts}名`);
  parts.push(`全体平均打率${baStr}`);
  return parts.join("・") + "。";
}

/**
 * スタッフ実績カードのひとことメモ（ロール別）。
 * 平均スコアトップと打率トップを示す。
 */
export function staffBucketComment(rows: StaffScorecard[]): string | null {
  if (rows.length === 0) return null;
  const topScore = rows.reduce((a, b) => (b.avgScore > a.avgScore ? b : a));
  const withBa = rows.filter((r) => isFinite(r.battingAverage) && r.battingAverage > 0);
  if (withBa.length === 0) return `平均スコア1位は${topScore.name}（${Math.round(topScore.avgScore)}点）。`;
  const topBa = withBa.reduce((a, b) => (b.battingAverage > a.battingAverage ? b : a));
  const baStr = `.${String(Math.round(topBa.battingAverage * 1000)).padStart(3, "0")}`;
  if (topScore.name === topBa.name) {
    return `${topScore.name}がスコア・打率ともに1位（平均${Math.round(topScore.avgScore)}点、打率${baStr}）。`;
  }
  return `平均スコア1位: ${topScore.name}（${Math.round(topScore.avgScore)}点）、打率1位: ${topBa.name}（${baStr}）。`;
}

/**
 * 制作会社スコアカードのひとことメモ。
 * 平均スコアトップと最多制作数スタジオを示す。
 */
export function studioBucketComment(rows: StudioScorecard[]): string | null {
  if (rows.length === 0) return null;
  const top = rows[0]; // avgScore 降順で先頭
  const mostWorks = rows.reduce((a, b) => (b.worksCount > a.worksCount ? b : a));
  if (top.studio === mostWorks.studio) {
    return `平均スコア・制作数ともにトップは${top.studio}（平均${Math.round(top.avgScore)}点・${top.worksCount}本）。`;
  }
  return `平均スコア1位: ${top.studio}（${Math.round(top.avgScore)}点）、制作数1位: ${mostWorks.studio}（${mostWorks.worksCount}本）。`;
}

/**
 * 人気作品ランキングのひとことメモ。
 * 1位の人気度と上位3作品の傾向を述べる。
 */
export function popularRankingComment(works: RatedWork[]): string | null {
  if (works.length === 0) return null;
  const top = works[0];
  const pop = top.popularity ?? 0;
  if (pop <= 0) return null;
  const note = pop >= 10000 ? "圧倒的な認知度" : pop >= 3000 ? "高い認知度" : "堅実な人気";
  return `人気1位は「${top.title}」（ウォッチャー数${pop.toLocaleString()}）—${note}。`;
}

/**
 * 高評価ランキングのひとことメモ（AniList/MAL 共用）。
 * 1位の作品とスコアを示す。
 */
export function ratedRankingComment(works: RatedWork[], metric: "anilist" | "mal"): string | null {
  if (works.length === 0) return null;
  const top = works[0];
  const score = metric === "anilist" ? top.anilist_score : top.mal_score;
  if (score == null) return null;
  const label = metric === "anilist" ? "AniList" : "MAL";
  return `${label}評価1位は「${top.title}」（${score}点）。`;
}

/**
 * ジャンル動向のひとことメモ。
 * 平均スコア最高のジャンルと作品数最多のジャンルを示す。
 */
export function genreTrendsComment(insights: GenreInsight[]): string | null {
  if (insights.length === 0) return null;
  const withScore = insights.filter((g) => g.avgScore != null);
  const parts: string[] = [];
  if (withScore.length > 0) {
    const topScore = withScore.reduce((a, b) => ((b.avgScore ?? 0) > (a.avgScore ?? 0) ? b : a));
    parts.push(`平均スコア最高ジャンルは「${genreJa(topScore.genre)}」（${topScore.avgScore?.toFixed(1)}点）`);
  }
  const topCount = insights.reduce((a, b) => (b.worksCount > a.worksCount ? b : a));
  parts.push(`最多作品ジャンルは「${genreJa(topCount.genre)}」（${topCount.worksCount}本）`);
  return parts.join("・") + "。";
}

/**
 * 認知×熱量 象限マップのひとことメモ（分析ハブ・Xバズタブ用）。
 * ファン型ダークホースと総合ヒットの代表作を指摘する。
 * データが薄い（4作品未満）場合は null。
 */
export function awarenessHeatComment(rows: AwarenessHeatRow[]): string | null {
  if (rows.length === 0) return null;

  const darkhorses = rows.filter((r) => r.quadrant === "fan_darkhorse");
  const hits = rows.filter((r) => r.quadrant === "total_hit");
  const prLeads = rows.filter((r) => r.quadrant === "general_pr");

  const parts: string[] = [];

  // ダークホース: 熱量が最も高い作品を代表として指摘。
  if (darkhorses.length > 0) {
    const rep = darkhorses.reduce((a, b) => (b.volume > a.volume ? b : a));
    parts.push(
      `ファン型ダークホースは「${rep.title}」。認知は低いが熱量（${Math.round(rep.volume * 10) / 10}/5）が突出`,
    );
  }

  // 総合ヒット: popularity が最も高い作品を代表。
  if (hits.length > 0) {
    const rep = hits.reduce((a, b) => (b.popularity > a.popularity ? b : a));
    parts.push(`総合ヒットは「${rep.title}」（認知・熱量ともに高）`);
  }

  // PR先行: hits/darkhorses が無いときだけ補足。
  if (parts.length === 0 && prLeads.length > 0) {
    const rep = prLeads.reduce((a, b) => (b.popularity > a.popularity ? b : a));
    parts.push(`「${rep.title}」は高認知だが熱量がまだ控えめ（PR先行）`);
  }

  if (parts.length === 0) return null;

  const total = rows.length;
  const dhCount = darkhorses.length;
  const suffix =
    dhCount > 0
      ? `。ダークホース候補${dhCount}作品（全${total}作品中）`
      : `（全${total}作品）`;

  return parts.join("。") + suffix + "。";
}

/**
 * 初速ランキングセクションのひとことメモ（視聴分析タブ用）。
 * 最も立ち上がりが強い作品と、第1話の実況コメント数を指摘する。
 */
export function fastStartComment(rows: FastStartRow[]): string | null {
  if (rows.length === 0) return null;
  const top = rows[0];
  if (top.ep1Comments <= 0) return null;

  const parts: string[] = [];
  parts.push(`最も立ち上がりが強いのは『${top.title}』（初速スコア ${top.score.toFixed(0)}点）`);
  parts.push(`第1話の実況が${top.ep1Comments.toLocaleString()}コメントで突出`);

  if (rows.length >= 2) {
    const runner = rows[1];
    parts.push(`次点は『${runner.title}』（${runner.score.toFixed(0)}点）`);
  }

  return parts.join("。") + "。";
}

/**
 * 国内×海外 人気乖離セクションのひとことメモ。
 * 海外先行・国内先行の代表作と、ライセンス強化の余地を述べる。
 * データが薄い（4作品未満）場合は null。
 */
export function globalGapComment(rows: GlobalGapRow[]): string | null {
  if (rows.length === 0) return null;

  const overseasLeads = rows.filter((r) => r.kind === "overseas_lead");
  const domesticLeads = rows.filter((r) => r.kind === "domestic_lead");
  const parts: string[] = [];

  if (overseasLeads.length > 0) {
    // 最も海外先行（gap 最大）の作品を代表として指摘
    const rep = overseasLeads.reduce((a, b) => (b.gap > a.gap ? b : a));
    parts.push(
      `海外先行は「${rep.title}」（海外${rep.overseas} vs 国内${rep.domestic}、乖離+${rep.gap}pt）。` +
      `国内人気の割に海外指標が突出＝海外配信・ライセンス強化の余地`,
    );
  }

  if (domesticLeads.length > 0) {
    // 最も国内先行（gap 最小）の作品を代表として指摘
    const rep = domesticLeads.reduce((a, b) => (b.gap < a.gap ? b : a));
    const absGap = Math.abs(rep.gap);
    parts.push(
      `国内先行は「${rep.title}」（国内${rep.domestic} vs 海外${rep.overseas}、乖離−${absGap}pt）。` +
      `国内人気に比べ海外認知はまだ少ない＝海外PR・字幕配信の先行投資機会`,
    );
  }

  if (parts.length === 0) {
    // 全作品が balanced なケース
    const balanced = rows.filter((r) => r.kind === "balanced").length;
    return `今期は国内・海外の人気差が小さい作品が多い（均衡${balanced}作品）。` +
      `乖離が大きい作品が出た際にライセンス判断の優先候補となる。`;
  }

  const total = rows.length;
  const oCount = overseasLeads.length;
  const dCount = domesticLeads.length;
  const countNote = `今期対象${total}作品中、海外先行${oCount}・国内先行${dCount}作品。`;

  return parts.join("。") + "。" + countNote;
}

/**
 * シーズン俯瞰ヒートマップのひとことメモ（視聴分析タブ用）。
 * 全話で最も盛り上がった作品×話数と、全話を通じてコメント数が安定している作品を指摘する。
 * データが薄い（2作品未満・有効ポイント0）場合は null。
 */
export function seasonHeatmapComment(series: RetentionSeries[]): string | null {
  const valid = series.filter((s) => s.points.length >= 1);
  if (valid.length < 2) return null;

  // 全セルを平坦化して最大コメント数の話（作品・話数ラベル・コメント数）を探す
  let peakWork: string | null = null;
  let peakLabel: string | null = null;
  let peakRecords = 0;

  for (const s of valid) {
    for (const p of s.points) {
      if (p.records > peakRecords) {
        peakRecords = p.records;
        peakWork = s.title;
        peakLabel = p.numberText ?? `第${p.episodeNumber}話`;
      }
    }
  }

  // 「全話通じて安定して濃い」＝各話コメント数の変動係数(CV)が最も小さい作品
  // CV = 標準偏差 / 平均。2話以上ある作品のみ対象。
  let stableWork: string | null = null;
  let stableCV = Infinity;

  for (const s of valid) {
    if (s.points.length < 3) continue;
    const vals = s.points.map((p) => p.records).filter((v) => v > 0);
    if (vals.length < 3) continue;
    const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
    if (mean <= 0) continue;
    const variance = vals.reduce((a, b) => a + (b - mean) ** 2, 0) / vals.length;
    const cv = Math.sqrt(variance) / mean;
    if (cv < stableCV) {
      stableCV = cv;
      stableWork = s.title;
    }
  }

  if (peakWork === null) return null;

  const parts: string[] = [];
  parts.push(
    `最も盛り上がった回は「${peakWork}」${peakLabel}（${peakRecords.toLocaleString()}コメント）`,
  );
  if (stableWork && stableWork !== peakWork) {
    parts.push(`全話通して安定して濃いのは「${stableWork}」`);
  }

  return parts.join("。") + "。";
}

/**
 * 急上昇アラートセクションのひとことメモ（視聴分析タブ用）。
 * 最も伸び率が高い作品と、その最新話のコメント数を指摘する。
 * データが空の場合は null。
 */
export function risersComment(rows: RiserRow[]): string | null {
  if (rows.length === 0) return null;
  const top = rows[0];
  const ep = top.latestLabel ? shortEp(top.latestLabel) : "最新話";
  const pct = Math.round(top.deltaPct);
  return `直近で最も伸びたのは『${top.title}』${ep}（前話まで平均比+${pct}%・${top.latestComments.toLocaleString()}コメント）。`;
}

/**
 * 続編可能性スコアセクションのひとことメモ（業界データタブ用）。
 * green 最上位作品と、継続率・人気が両立している点を指摘する。
 * データが空の場合は null。
 */
export function sequelProspectComment(rows: SequelProspectRow[]): string | null {
  if (rows.length === 0) return null;
  const top = rows[0];

  // green 作品数
  const greenCount = rows.filter((r) => r.signal === "green").length;
  const yellowCount = rows.filter((r) => r.signal === "yellow").length;

  const scoreNote = `（スコア ${top.score.toFixed(0)}点）`;

  // 1位の作品の強みを言語化
  const strengths: string[] = [];
  if (top.retentionPct != null && top.retentionPct >= 70) {
    strengths.push(`継続率${Math.round(top.retentionPct)}%`);
  }
  if (top.popularityPctl != null && top.popularityPctl >= 70) {
    strengths.push("高い人気");
  }
  if (top.xVolume != null && top.xVolume >= 3) {
    strengths.push(`X盛り上がり${Math.round(top.xVolume * 10) / 10}/5`);
  }

  const strengthNote =
    strengths.length >= 2
      ? `${strengths.join("と")}が両立`
      : strengths.length === 1
        ? `特に${strengths[0]}が突出`
        : "複数シグナルをバランスよく積み上げた";

  const distNote =
    greenCount > 0
      ? `今期: 続編期待大${greenCount}作品・条件次第${yellowCount}作品。`
      : `今期: 条件次第${yellowCount}作品が多く、現状厳しい作品が大半。`;

  return `続編期待が最も高いのは『${top.title}』${scoreNote}。${strengthNote}。${distNote}`;
}

/**
 * 総合スコアの根拠説明（作品詳細ページ KPI 直下表示用）。
 *
 * 当該作品の OverallRankingRow.signals から、最も寄与している上位1〜2シグナルと
 * 足を引っ張っている弱いシグナルを名指しし、スコアの透明性を高める短文を返す。
 * データが null または有効シグナルが存在しない場合は null を返す（防御的）。
 *
 * 閾値:
 *   - 上位シグナル: パーセンタイル >= 70（「牽引」と表現）
 *   - 弱いシグナル: パーセンタイル <= 35（「やや弱め」と表現）
 */
export function scoreReason(row: OverallRankingRow | null): string | null {
  if (row == null) return null;

  const sigs = row.signals;

  // シグナルラベルマップ
  const sigLabels: Array<{ key: keyof typeof sigs; label: string }> = [
    { key: "awareness", label: "認知" },
    { key: "review",    label: "批評" },
    { key: "jikkyo",    label: "実況" },
    { key: "xbuzz",     label: "Xバズ" },
    { key: "retention", label: "継続/満足" },
  ];

  // 有効なシグナルのみ抽出
  const present = sigLabels
    .map(({ key, label }) => ({ label, pct: sigs[key] }))
    .filter((s): s is { label: string; pct: number } => s.pct != null);

  // データが無い場合は非表示
  if (present.length === 0) return null;

  // 上位シグナル（強い牽引）: パーセンタイル >= 70、降順で最大2件
  const strong = present
    .filter((s) => s.pct >= 70)
    .sort((a, b) => b.pct - a.pct)
    .slice(0, 2);

  // 弱いシグナル（足引き）: パーセンタイル <= 35、昇順で最大1件
  const weak = present
    .filter((s) => s.pct <= 35)
    .sort((a, b) => a.pct - b.pct)
    .slice(0, 1);

  // どちらもなければ「バランス型」で短文
  if (strong.length === 0 && weak.length === 0) {
    return `総合スコア ${row.score.toFixed(0)}pt は複数シグナルをバランスよく積み上げた結果です。`;
  }

  const parts: string[] = [];

  if (strong.length > 0) {
    const strongStr = strong
      .map((s) => `${s.label}（上位${Math.round(100 - s.pct)}%）`)
      .join("と");
    parts.push(`${strongStr}が牽引`);
  }

  if (weak.length > 0) {
    const weakStr = weak
      .map((s) => `${s.label}（下位${Math.round(s.pct)}%）`)
      .join("・");
    parts.push(`${weakStr}はやや弱め`);
  }

  return `総合スコアは${parts.join("。")}。`;
}

/**
 * 混雑スロット（競合の多い枠）セクションのひとことメモ。
 * 最も作品数が多いスロットと、2位との差を述べる。
 * データが薄い（2スロット未満・最大2作品以下）場合は null。
 */
export function timeslotCompetitionComment(slots: TimeslotCompetitionSlot[]): string | null {
  const contested = slots.filter((s) => s.count >= 2);
  if (contested.length < 1) return null;
  const top = contested[0]!;
  const dow = TIMESLOT_WEEKDAYS[top.weekday] ?? "?";
  const hourLabel = top.hour >= 24 ? `深夜${top.hour}時` : `${top.hour}時`;
  const second = contested[1];
  const secondNote = second
    ? `次点は${TIMESLOT_WEEKDAYS[second.weekday] ?? "?"}${second.hour >= 24 ? `深夜${second.hour}時` : `${second.hour}時`}台（${second.count}作品）。`
    : "";
  return `最も競合が激しいのは${dow}${hourLabel}台（${top.count}作品）。${secondNote}`;
}
