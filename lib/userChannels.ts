/**
 * ユーザーの放送局設定（app_users.preferred_channels）の読み書き。
 * マイグレーション 0010 が未適用でも落ちないよう、エラー時は空配列へフォールバックする。
 * 空配列は「未設定」を意味し、呼び出し側は地域の種 / 全放送波へフォールバックする。
 */
import { getAdminClient } from "./supabase/admin.ts";

export async function getUserChannels(userId: string): Promise<string[]> {
  try {
    const db = getAdminClient();
    const { data, error } = await db
      .from("app_users")
      .select("preferred_channels")
      .eq("id", userId)
      .maybeSingle();
    if (error) return []; // 列が無い等
    const value = (data as { preferred_channels?: unknown } | null)?.preferred_channels;
    if (!Array.isArray(value)) return [];
    return value.filter((v): v is string => typeof v === "string" && v.length > 0);
  } catch {
    return [];
  }
}

export async function setUserChannels(userId: string, channels: string[]): Promise<void> {
  try {
    const db = getAdminClient();
    const clean = channels.filter((c) => typeof c === "string" && c.length > 0);
    await db.from("app_users").update({ preferred_channels: clean }).eq("id", userId);
  } catch {
    // 列が無い等はサイレントに無視（放送局設定は任意）
  }
}
