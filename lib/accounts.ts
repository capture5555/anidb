import { encryptToken, decryptToken } from "./crypto";
import { refreshAccessToken, GOOGLE_SCOPES, type GoogleUserInfo } from "./google/oauth";
import type { SessionData } from "./session";

function supabaseEnabled(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

/**
 * OAuth成功後に呼ぶ。
 * Supabase利用時: app_users / google_accounts を upsert（リフレッシュトークンは暗号化保存）。
 * 未設定時(デモ): DB保存はせず、refreshToken をセッションに入れるための値を返す。
 */
export async function saveGoogleAccount(
  user: GoogleUserInfo,
  refreshToken: string | undefined,
): Promise<{ userId: string; storeInSession: boolean }> {
  if (!supabaseEnabled()) {
    // デモ: セッションに保持
    return { userId: user.sub, storeInSession: true };
  }

  const { getAdminClient } = await import("./supabase/admin");
  const db = getAdminClient();

  // app_users（id=Google sub を流用）
  await db.from("app_users").upsert(
    { id: user.sub, email: user.email, display_name: user.name ?? null },
    { onConflict: "id" },
  );

  const update: Record<string, unknown> = {
    user_id: user.sub,
    google_sub: user.sub,
    scopes: GOOGLE_SCOPES,
    token_updated_at: new Date().toISOString(),
  };
  // refresh_token は再同意時のみ返るため、得られた時だけ更新（既存を消さない）
  if (refreshToken) update.refresh_token_encrypted = encryptToken(refreshToken);

  await db.from("google_accounts").upsert(update, { onConflict: "google_sub" });

  return { userId: user.sub, storeInSession: false };
}

/** セッションのユーザーについて、有効なアクセストークンを取得する */
export async function getAccessTokenForSession(session: SessionData): Promise<string | null> {
  // デモ: セッション内のリフレッシュトークン
  if (session.refreshToken) {
    return refreshAccessToken(session.refreshToken);
  }
  if (!supabaseEnabled()) return null;

  const { getAdminClient } = await import("./supabase/admin");
  const db = getAdminClient();
  const { data } = await db
    .from("google_accounts")
    .select("refresh_token_encrypted")
    .eq("user_id", session.userId)
    .maybeSingle();
  if (!data?.refresh_token_encrypted) return null;
  const refreshToken = decryptToken(data.refresh_token_encrypted);
  return refreshAccessToken(refreshToken);
}
