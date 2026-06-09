import type { GoogleUserInfo } from "./google/oauth.ts";
import { googleSubToUserId } from "./userId.ts";

function supabaseEnabled(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

/**
 * OAuth成功後に呼ぶ。本人識別情報（app_users / google_accounts）の upsert のみ行う。
 * リフレッシュトークンは扱わない（カレンダーへの書き込みは廃止済み・ICSフィード方式）。
 */
export async function saveGoogleAccount(user: GoogleUserInfo): Promise<{ userId: string }> {
  // Googleの sub から決定的なUUIDを生成（DBのuuid型カラムに合わせる）
  const userId = googleSubToUserId(user.sub);

  if (!supabaseEnabled()) {
    // デモ: DB保存はしない
    return { userId };
  }

  const { getAdminClient } = await import("./supabase/admin");
  const db = getAdminClient();

  const { error: userErr } = await db.from("app_users").upsert(
    { id: userId, email: user.email, display_name: user.name ?? null },
    { onConflict: "id" },
  );
  if (userErr) console.error("[saveGoogleAccount] app_users upsert", userErr);

  const { error: gaErr } = await db
    .from("google_accounts")
    .upsert({ user_id: userId, google_sub: user.sub }, { onConflict: "google_sub" });
  if (gaErr) console.error("[saveGoogleAccount] google_accounts upsert", gaErr);

  return { userId };
}
