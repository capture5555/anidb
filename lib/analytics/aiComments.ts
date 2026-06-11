/**
 * AIコメント／ニュースの履歴データ層（ai_comments テーブル）。
 *
 * 生成のたびに append し、過去分を generated_at で遡って見返せるようにする。
 * すべて防御的: テーブル未作成（0015 未適用）・失敗・欠落はすべて no-op / [] / null に正規化する。
 * これにより、マイグレーション適用前でもアプリは従来どおり動作する（履歴が空になるだけ）。
 */
import { getAdminClient } from "../supabase/admin.ts";

export type AiCommentScope = "season" | "work" | "episode" | "news" | (string & {});

export interface AiComment {
  id: number;
  scope: string;
  refId: string | null;
  title: string | null;
  body: string;
  meta: Record<string, unknown>;
  generatedAt: string;
}

export interface RecordAiCommentInput {
  scope: AiCommentScope;
  refId?: string | null;
  title?: string | null;
  body: string;
  meta?: Record<string, unknown>;
}

/** 任意の行を AiComment に正規化（壊れた行は null）。 */
function normalize(row: unknown): AiComment | null {
  if (!row || typeof row !== "object") return null;
  const o = row as Record<string, unknown>;
  const body = typeof o.body === "string" ? o.body : "";
  if (body.length === 0) return null;
  const metaRaw = o.meta;
  return {
    id: Number(o.id) || 0,
    scope: String(o.scope ?? ""),
    refId: (o.ref_id as string | null) ?? null,
    title: (o.title as string | null) ?? null,
    body,
    meta:
      metaRaw && typeof metaRaw === "object" && !Array.isArray(metaRaw)
        ? (metaRaw as Record<string, unknown>)
        : {},
    generatedAt: String(o.generated_at ?? ""),
  };
}

/**
 * AIコメントを1件追記する（cron/コレクタから呼ぶ）。
 * テーブル未作成・失敗は握りつぶす（呼び出し側の処理を壊さない）。成否を boolean で返す。
 */
export async function recordAiComment(input: RecordAiCommentInput): Promise<boolean> {
  try {
    const db = getAdminClient();
    const { error } = await db.from("ai_comments").insert({
      scope: input.scope,
      ref_id: input.refId ?? null,
      title: input.title ?? null,
      body: input.body,
      meta: input.meta ?? {},
    });
    return !error;
  } catch {
    return false;
  }
}

/**
 * scope（任意で refId）の履歴を新しい順に取得。失敗・未作成は []。
 */
export async function getAiCommentHistory(
  scope: AiCommentScope,
  refId?: string | null,
  limit = 30,
): Promise<AiComment[]> {
  try {
    const db = getAdminClient();
    let q = db
      .from("ai_comments")
      .select("id, scope, ref_id, title, body, meta, generated_at")
      .eq("scope", scope)
      .order("generated_at", { ascending: false })
      .limit(Math.max(1, Math.min(limit, 200)));
    if (refId != null) q = q.eq("ref_id", refId);
    const { data, error } = await q;
    if (error) return [];
    return (data ?? []).map(normalize).filter((c): c is AiComment => c != null);
  } catch {
    return [];
  }
}

/** scope（任意で refId）の最新1件。無ければ null。 */
export async function getLatestAiComment(
  scope: AiCommentScope,
  refId?: string | null,
): Promise<AiComment | null> {
  const rows = await getAiCommentHistory(scope, refId, 1);
  return rows[0] ?? null;
}

/**
 * 横断的に最新のAIコメントを取得（履歴ページ用）。scope を絞らず新着順。
 * 失敗・未作成は []。
 */
export async function getRecentAiComments(limit = 50): Promise<AiComment[]> {
  try {
    const db = getAdminClient();
    const { data, error } = await db
      .from("ai_comments")
      .select("id, scope, ref_id, title, body, meta, generated_at")
      .order("generated_at", { ascending: false })
      .limit(Math.max(1, Math.min(limit, 200)));
    if (error) return [];
    return (data ?? []).map(normalize).filter((c): c is AiComment => c != null);
  } catch {
    return [];
  }
}
