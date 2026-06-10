/**
 * 作品単位のリアクション分析を、既存の WorkAnalysis（getWorkAnalysis の戻り値）から
 * 派生計算するモジュール。DBには触れない純粋関数。
 *
 * 元データ: analysis.episodes[].points[].reactions（分単位×カテゴリの該当数）と .peaks。
 *
 * 重要な注意（誤読防止）:
 *   1コメントは複数カテゴリに該当しうる（例: 「神作画www」→ hype/sakuga/laugh）。
 *   したがってカテゴリ該当数の合計は「コメント総数」とは一致しない。
 *   - share（構成比）= そのカテゴリの該当数 ÷ 全カテゴリ該当数の合計（＝リアクションの"味付け"）
 *   - mentionRate（該当率）= そのカテゴリの該当数 ÷ コメント総数（＝どれくらいの人がそう反応したか）
 *   UI 側は「1コメントが複数に該当しうる」旨を必ず併記すること。
 */
import type { WorkAnalysis } from "./viewing.ts";
import type { ReactionCategory } from "./commentAnalysis.ts";

/** スタックの並び順（MinuteHeatChart の REACTION_META と一致させる） */
export const REACTION_ORDER: ReactionCategory[] = [
  "laugh",
  "hype",
  "cry",
  "surprise",
  "sakuga",
  "scream",
];

export interface ReactionShare {
  category: ReactionCategory;
  count: number;
  /** 構成比（全カテゴリ該当数に占める割合, 0..1）。stackして1になる */
  share: number;
  /** 該当率（コメント総数に占める割合, 0..1）。重複ありなので合計は1を超えうる */
  mentionRate: number;
}

export interface EpisodeReactionMix {
  episodeLabel: string;
  totalComments: number;
  /** REACTION_ORDER 順・全6カテゴリぶん（0も含む）。share合計は1（該当が無い話は全0） */
  shares: ReactionShare[];
}

export interface WorkReactionBreakdown {
  /** 作品全体のカテゴリ別（REACTION_ORDER順・全6カテゴリ） */
  overall: ReactionShare[];
  /** リアクション該当の延べ数（構成比の分母） */
  totalReactionHits: number;
  /** 実況コメント総数（該当率の分母） */
  totalComments: number;
  /** 最も構成比の高いカテゴリ。データ不足時 null */
  dominant: { category: ReactionCategory; share: number } | null;
  /** 話数別の味付け推移（small multiples 用） */
  perEpisode: EpisodeReactionMix[];
}

type CatSums = Record<ReactionCategory, number>;
const zeroSums = (): CatSums => ({ laugh: 0, hype: 0, cry: 0, surprise: 0, sakuga: 0, scream: 0 });

/** 1話ぶんの points からカテゴリ別の該当数を合計する */
function sumEpisode(points: WorkAnalysis["episodes"][number]["points"]): CatSums {
  const s = zeroSums();
  for (const p of points) {
    for (const cat of REACTION_ORDER) {
      const v = p.reactions[cat];
      if (v) s[cat] += v;
    }
  }
  return s;
}

const sumAll = (s: CatSums): number => REACTION_ORDER.reduce((a, c) => a + s[c], 0);

/** CatSums を ReactionShare[]（REACTION_ORDER順）へ。share分母=hitsTotal, mentionRate分母=comments */
function toShares(s: CatSums, hitsTotal: number, comments: number): ReactionShare[] {
  return REACTION_ORDER.map((category) => ({
    category,
    count: s[category],
    share: hitsTotal > 0 ? s[category] / hitsTotal : 0,
    mentionRate: comments > 0 ? s[category] / comments : 0,
  }));
}

/**
 * 作品全体＋話数別のリアクション構成を計算する。
 * リアクション該当が1件も無ければ null（＝表示しない）。
 */
export function buildWorkReactions(analysis: WorkAnalysis): WorkReactionBreakdown | null {
  const eps = analysis.episodes;
  if (eps.length === 0) return null;

  const overallSums = zeroSums();
  let totalComments = 0;
  const perEpisode: EpisodeReactionMix[] = [];

  for (const ep of eps) {
    const s = sumEpisode(ep.points);
    const epHits = sumAll(s);
    for (const cat of REACTION_ORDER) overallSums[cat] += s[cat];
    totalComments += ep.totalComments;
    perEpisode.push({
      episodeLabel: ep.episodeLabel,
      totalComments: ep.totalComments,
      shares: toShares(s, epHits, ep.totalComments),
    });
  }

  const totalReactionHits = sumAll(overallSums);
  if (totalReactionHits === 0) return null;

  const overall = toShares(overallSums, totalReactionHits, totalComments);
  const dominant = overall.reduce<{ category: ReactionCategory; share: number } | null>(
    (best, r) => (best == null || r.share > best.share ? { category: r.category, share: r.share } : best),
    null,
  );

  return { overall, totalReactionHits, totalComments, dominant, perEpisode };
}

// ---------------------------------------------------------------- 名場面（瞬間最大風速）

export interface WorkMoment {
  episodeLabel: string;
  minute: number;
  /** その分のコメント数 */
  total: number;
  comments: { text: string; count: number }[];
}

/**
 * 作品の全話を通した「盛り上がった瞬間」TOP。
 * 各話の peaks（ピーク分の代表コメント）に、その分の総コメント数を付けて全話横断でソートする。
 */
export function buildWorkMoments(analysis: WorkAnalysis, limit = 5): WorkMoment[] {
  const moments: WorkMoment[] = [];
  for (const ep of analysis.episodes) {
    const totalByMinute = new Map(ep.points.map((p) => [p.minute, p.total]));
    for (const peak of ep.peaks) {
      const total = totalByMinute.get(peak.minute) ?? 0;
      if (total <= 0) continue;
      moments.push({
        episodeLabel: ep.episodeLabel,
        minute: peak.minute,
        total,
        comments: peak.comments ?? [],
      });
    }
  }
  moments.sort((a, b) => b.total - a.total);
  return moments.slice(0, limit);
}
