/**
 * 実況コメントの内容分析モジュール。
 * MeCab等の形態素解析は使わず、リアクション辞書（正規表現）＋表記ゆれ正規化の軽量実装。
 * 辞書を改良したら scripts/reanalyze-comments.ts で保存済み生ログから全番組分を再計算できる。
 */

import type { JikkyoComment } from "../adapters/jikkyo.ts";

export type ReactionCategory = "laugh" | "cry" | "hype" | "surprise" | "sakuga" | "scream";

/** リアクション辞書（カテゴリ → パターン群）。1コメントが複数カテゴリに該当してよい */
const REACTION_DICT: Record<ReactionCategory, RegExp[]> = {
  laugh: [/w{2,}/, /草/, /ワロタ|わろた/, /くさ[あぁ]?$/, /笑/, /ファ?ｗ/],
  cry: [/泣/, /涙/, /感動/, /エモ|えもい/, /うるっ/, /;;|；；|｡ﾟ\(/],
  hype: [/神/, /すげ[えぇー]*/, /すご[いっ]/, /やば[いっ]?/, /最高/, /かっこい|カッコイ|かっけ/, /鳥肌/],
  surprise: [/!\?/, /ファッ|ふぁっ!?/, /え[えぇー]{2,}/, /^は\?$/, /まじか|マジか|まじで|マジで/, /なんだと|なんやて/],
  sakuga: [/作画/, /ぬるぬる/, /作豪/, /枚数/, /よく動く/],
  scream: [/キタ[ーァ]+|きた[ーぁ]+|ｷﾀ/, /う[おぉ]{2,}/, /お{3,}/, /うわ[あぁ]{2,}/, /ぎゃ[ー]+|ギャ[ー]+/],
};

/**
 * 表記ゆれの統合（頻出コメント抽出用）。
 * - NFKC正規化（全角英数/ｗ/！？ → 半角）
 * - 英字は小文字へ
 * - 同一文字の3回以上の繰り返しを2回に圧縮（wwww→ww、おおおお→おお、ーーー→ーー）
 */
export function normalizeComment(content: string): string {
  let s = content.normalize("NFKC").toLowerCase().trim();
  s = s.replace(/(.)\1{2,}/g, "$1$1");
  return s;
}

/** 1コメントが該当するリアクションカテゴリ（複数可） */
export function classifyComment(content: string): ReactionCategory[] {
  const s = normalizeComment(content);
  const hits: ReactionCategory[] = [];
  for (const [category, patterns] of Object.entries(REACTION_DICT) as [ReactionCategory, RegExp[]][]) {
    if (patterns.some((p) => p.test(s))) hits.push(category);
  }
  return hits;
}

export interface MinuteHeat {
  minute: number;
  count: number;
}

export interface MinuteReaction {
  minute: number;
  category: ReactionCategory;
  count: number;
}

export interface PeakComments {
  minute: number;
  count: number;
  /** 正規化後の出現数上位（その瞬間みんなが何と言ったか） */
  top: { text: string; count: number }[];
}

export interface ProgramAnalysis {
  heat: MinuteHeat[];
  reactions: MinuteReaction[];
  peaks: PeakComments[];
  totalComments: number;
}

const PEAK_MINUTES = 3; // ピークとして保存する分の数（heat上位）
const PEAK_TOP_N = 5; // ピーク分ごとの代表コメント数

/**
 * 1番組ぶんのコメントから、分単位 heat / カテゴリ別 counts / ピーク分の代表コメントをまとめて返す。
 * @param startUnix 放送開始時刻（unix秒）。minute_offset の基準
 */
export function analyzeProgram(comments: JikkyoComment[], startUnix: number): ProgramAnalysis {
  const heatMap = new Map<number, number>();
  const reactionMap = new Map<string, number>(); // "minute:category" → count
  const byMinuteTexts = new Map<number, Map<string, number>>(); // minute → 正規化テキスト → count

  let total = 0;
  for (const c of comments) {
    const minute = Math.floor((c.date - startUnix) / 60);
    if (minute < 0) continue;
    total++;
    heatMap.set(minute, (heatMap.get(minute) ?? 0) + 1);

    for (const category of classifyComment(c.content)) {
      const key = `${minute}:${category}`;
      reactionMap.set(key, (reactionMap.get(key) ?? 0) + 1);
    }

    const norm = normalizeComment(c.content);
    if (norm.length > 0 && norm.length <= 50) {
      if (!byMinuteTexts.has(minute)) byMinuteTexts.set(minute, new Map());
      const texts = byMinuteTexts.get(minute)!;
      texts.set(norm, (texts.get(norm) ?? 0) + 1);
    }
  }

  const heat: MinuteHeat[] = [...heatMap.entries()]
    .map(([minute, count]) => ({ minute, count }))
    .sort((a, b) => a.minute - b.minute);

  const reactions: MinuteReaction[] = [...reactionMap.entries()]
    .map(([key, count]) => {
      const [minute, category] = key.split(":");
      return { minute: Number(minute), category: category as ReactionCategory, count };
    })
    .sort((a, b) => a.minute - b.minute || a.category.localeCompare(b.category));

  const peaks: PeakComments[] = [...heatMap.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, PEAK_MINUTES)
    .map(([minute, count]) => {
      const texts = byMinuteTexts.get(minute) ?? new Map<string, number>();
      const top = [...texts.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, PEAK_TOP_N)
        .map(([text, c]) => ({ text, count: c }));
      return { minute, count, top };
    })
    .sort((a, b) => a.minute - b.minute);

  return { heat, reactions, peaks, totalComments: total };
}
