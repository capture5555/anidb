import { NextResponse, type NextRequest } from "next/server";
import { getAdminClient } from "@/lib/supabase/admin";
import {
  GATE_COOKIE,
  GATE_TTL_MS,
  getAuthSecret,
  isGateEnabled,
  safeNextPath,
  signToken,
} from "@/lib/auth/gate";

export const dynamic = "force-dynamic";

/**
 * 入口パスワードの照合。フォーム(POST: password, next)を受け取り、
 * site_passwords に有効な一致があれば used_count を +1（上限/期限を満たすときのみ）して
 * 署名Cookieを発行し next へリダイレクトする。失敗は /gate?error=1 へ戻す。
 */
export async function POST(req: NextRequest) {
  const form = await req.formData().catch(() => null);
  const password = String(form?.get("password") ?? "").trim();
  const next = safeNextPath(String(form?.get("next") ?? "/"));
  const origin = req.nextUrl.origin;

  const fail = () =>
    NextResponse.redirect(
      `${origin}/gate?error=1&next=${encodeURIComponent(next)}`,
      { status: 303 },
    );

  // ゲート無効（設定不足）ならそのまま通す。
  if (!isGateEnabled()) {
    return NextResponse.redirect(`${origin}${next}`, { status: 303 });
  }
  if (password.length === 0) return fail();

  try {
    const db = getAdminClient();
    // 1) パスワード一致の有効行を引く。
    const { data: rows, error } = await db
      .from("site_passwords")
      .select("id")
      .eq("active", true)
      .eq("password", password)
      .limit(1);
    if (error || !rows || rows.length === 0) return fail();
    const id = (rows[0] as { id: number }).id;

    // 2) 上限・期限を確認して満たせば used_count を +1 し、Cookie を発行する。
    return await finalizeLogin(db, id, origin, next);
  } catch {
    return fail();
  }
}

/** used_count を確認して条件を満たせば +1 し、Cookie を発行する。 */
async function finalizeLogin(
  db: ReturnType<typeof getAdminClient>,
  id: number,
  origin: string,
  next: string,
): Promise<NextResponse> {
  const fail = () =>
    NextResponse.redirect(`${origin}/gate?error=1&next=${encodeURIComponent(next)}`, { status: 303 });

  const { data, error } = await db
    .from("site_passwords")
    .select("max_uses, used_count, expires_at")
    .eq("id", id)
    .maybeSingle();
  if (error || !data) return fail();
  const maxUses = (data.max_uses as number | null) ?? null;
  const usedCount = (data.used_count as number | null) ?? 0;
  const expiresAt = data.expires_at as string | null;

  if (expiresAt && new Date(expiresAt).getTime() <= Date.now()) return fail(); // 期限切れ＝失効
  if (maxUses != null && usedCount >= maxUses) return fail(); // 上限到達＝キャンセル

  await db
    .from("site_passwords")
    .update({ used_count: usedCount + 1 })
    .eq("id", id);

  const expMs = Date.now() + GATE_TTL_MS;
  const token = await signToken(getAuthSecret(), expMs);
  const res = NextResponse.redirect(`${origin}${next}`, { status: 303 });
  res.cookies.set(GATE_COOKIE, token, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: Math.floor(GATE_TTL_MS / 1000),
  });
  return res;
}
