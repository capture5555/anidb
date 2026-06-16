/**
 * ユーザーの放送地域設定（app_users.region）の読み書き。
 * マイグレーション 0008 が未適用でも落ちないよう、エラー時は既定地域へフォールバックする。
 */
import { getAdminClient } from "./supabase/admin.ts";
import { DEFAULT_REGION, parseRegion, type Region } from "./regions.ts";

export async function getUserRegion(userId: string): Promise<Region> {
  try {
    const db = getAdminClient();
    const { data, error } = await db
      .from("app_users")
      .select("region")
      .eq("id", userId)
      .maybeSingle();
    if (error) return DEFAULT_REGION; // 列が無い等
    return parseRegion(data?.region ?? null);
  } catch {
    return DEFAULT_REGION;
  }
}

export async function setUserRegion(userId: string, region: Region): Promise<void> {
  try {
    const db = getAdminClient();
    await db.from("app_users").update({ region }).eq("id", userId);
  } catch {
    // 列が無い等はサイレントに無視（地域設定は任意）
  }
}
