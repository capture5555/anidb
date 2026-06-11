/**
 * 「今日のアニメニュース」の読み取り層。
 *
 * collector(scripts/collect-x-buzz.ts の generateDailyNews)が ai_comments テーブルに
 * scope="news", refId=YYYY-MM-DD(JST) で書き込んだ行を読む。
 *
 * すべて防御的: テーブル未作成(0015 未適用)・失敗・欠落はすべて null / [] に正規化する。
 */

import { getLatestAiComment, getAiCommentHistory } from "./aiComments.ts";

/** 1件のニュースアイテム。 */
export interface NewsItem {
  title: string;
  summary: string;
  url?: string;
}

/** 今日のアニメニュース（最新1件分）。 */
export interface DailyNews {
  /** refId。形式: "YYYY-MM-DD" (JST)。 */
  date: string;
  /** 概況テキスト（1〜2文。空文字もありうる）。 */
  body: string;
  /** ニュース項目（最大8件）。 */
  items: NewsItem[];
  /** ai_comments.generated_at (ISO 文字列)。 */
  generatedAt: string;
}

/** meta.items を NewsItem[] に安全に変換する。 */
function toNewsItems(meta: Record<string, unknown>): NewsItem[] {
  const raw = meta.items;
  if (!Array.isArray(raw)) return [];
  const out: NewsItem[] = [];
  for (const v of raw) {
    if (!v || typeof v !== "object") continue;
    const o = v as Record<string, unknown>;
    const title = typeof o.title === "string" ? o.title.trim() : "";
    const summary = typeof o.summary === "string" ? o.summary.trim() : "";
    if (!title) continue;
    const url =
      typeof o.url === "string" && o.url.startsWith("http") ? o.url : undefined;
    out.push({ title, summary: summary || title, ...(url ? { url } : {}) });
    if (out.length >= 8) break;
  }
  return out;
}

/**
 * 最新のアニメニュースを取得する（scope="news" の最新1件）。
 * 未生成・失敗・items が空の場合は null（防御的）。
 */
export async function getLatestDailyNews(): Promise<DailyNews | null> {
  try {
    const comment = await getLatestAiComment("news");
    if (!comment) return null;
    const items = toNewsItems(comment.meta);
    if (items.length === 0) return null;
    return {
      date: comment.refId ?? comment.generatedAt.slice(0, 10),
      body: comment.body ?? "",
      items,
      generatedAt: comment.generatedAt,
    };
  } catch {
    return null;
  }
}

/**
 * ニュース履歴を新しい順で返す（ai-log 等から呼ぶ用途向け）。
 * 失敗は []（防御的）。
 */
export async function getDailyNewsHistory(limit = 30): Promise<DailyNews[]> {
  try {
    const comments = await getAiCommentHistory("news", undefined, limit);
    const out: DailyNews[] = [];
    for (const c of comments) {
      const items = toNewsItems(c.meta);
      if (items.length === 0) continue;
      out.push({
        date: c.refId ?? c.generatedAt.slice(0, 10),
        body: c.body ?? "",
        items,
        generatedAt: c.generatedAt,
      });
    }
    return out;
  } catch {
    return [];
  }
}
