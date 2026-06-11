/**
 * 今期の「所感」コメント（Grok x_search 由来）の読み取り層。
 *
 * collector(scripts/collect-x-buzz.ts)が cron 実行のたびに x_search を1クエリだけ使って
 * 「今期アニメ全体の X 上の話題・評価傾向」を Grok に要約させ、スナップショット
 * ("x_season_comment") に保存する。メイン分析画面はそれを読むだけ（即表示）。
 *
 * すべて防御的: スナップショット未生成・テーブル未作成・失敗は null に正規化する。
 */
import { readSnapshot } from "./snapshots.ts";

export const SEASON_COMMENT_KEY = "x_season_comment";

export interface SeasonComment {
  /** 整形済みの所感本文。 */
  text: string;
  /** 生成時刻(ISO)。 */
  generatedAt: string;
  /** 対象クールの表示ラベル（例「2026年春」）。 */
  label: string;
}

/** 型を正規化（payload が壊れていても null に倒す）。 */
function normalize(v: unknown): SeasonComment | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const text = typeof o.text === "string" ? o.text.trim() : "";
  if (text.length === 0) return null;
  return {
    text,
    generatedAt: typeof o.generatedAt === "string" ? o.generatedAt : "",
    label: typeof o.label === "string" ? o.label : "",
  };
}

/** 今期の所感コメントを読む。未生成・失敗は null（防御的）。 */
export async function getSeasonComment(): Promise<SeasonComment | null> {
  try {
    return normalize(await readSnapshot<unknown>(SEASON_COMMENT_KEY));
  } catch {
    return null;
  }
}
