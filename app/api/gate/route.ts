import { NextResponse, type NextRequest } from "next/server";
import {
  GATE_COOKIE,
  GATE_TTL_MS,
  checkPassword,
  isGateEnabled,
  safeNextPath,
  signToken,
} from "@/lib/auth/gate";

export const dynamic = "force-dynamic";

/**
 * 入口パスワードの照合（パスワードのみ）。フォーム(POST: password, next)を受け取り、
 * SITE_PASSWORD と一致すれば署名Cookieを発行して next へリダイレクトする。
 * 失敗は /gate?error=1 へ戻す。
 */
export async function POST(req: NextRequest) {
  const form = await req.formData().catch(() => null);
  const password = String(form?.get("password") ?? "");
  const next = safeNextPath(String(form?.get("next") ?? "/"));
  const origin = req.nextUrl.origin;

  // ゲート無効ならそのまま通す。
  if (!isGateEnabled()) {
    return NextResponse.redirect(`${origin}${next}`, { status: 303 });
  }

  if (!checkPassword(password)) {
    return NextResponse.redirect(
      `${origin}/gate?error=1&next=${encodeURIComponent(next)}`,
      { status: 303 },
    );
  }

  const token = await signToken(Date.now() + GATE_TTL_MS);
  const res = NextResponse.redirect(`${origin}${next}`, { status: 303 });
  res.cookies.set(GATE_COOKIE, token, {
    httpOnly: true,
    // localhost(http)では Secure Cookie が保存されず締め出されるため本番のみ Secure。
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: Math.floor(GATE_TTL_MS / 1000),
  });
  return res;
}
