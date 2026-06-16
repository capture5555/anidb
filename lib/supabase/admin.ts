import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * service role キーを使うサーバー専用クライアント。
 * RLSをバイパスできるため、cron/取り込み/トークン操作など信頼済みのサーバー処理でのみ使う。
 * 絶対にクライアント(ブラウザ)へ渡さない。
 */
let admin: SupabaseClient | null = null;

export function getAdminClient(): SupabaseClient {
  if (admin) return admin;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      "Supabase admin client requires NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY",
    );
  }
  admin = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return admin;
}
