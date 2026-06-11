/**
 * セクションごとの「ひとことメモ」を作る純関数群。
 *
 * 各分析セクションに1つ、データから機械的に導く短い所感を添えるための文章生成。
 * すべて純関数（DBアクセスなし）で、データが薄いときは null を返す（＝メモ非表示）。
 * 統計に基づく即時コメントなので、Grok等のLLMは使わずルールベースで生成する。
 */
import type { WorkAnalysis } from "./viewing.ts";
import type { WorkReactionBreakdown } from "./workReactions.ts";
import type { ReactionCategory } from "./commentAnalysis.ts";

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
  if (eps.length < 2) return null;
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
