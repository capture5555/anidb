import { NextResponse, type NextRequest } from "next/server";
import { GATE_COOKIE, getAuthSecret, isGateEnabled, isPublicPath, verifyToken } from "@/lib/auth/gate";

/**
 * サイト入口パスワードゲート。
 * SITE_GATE_ENABLED=1 かつ SITE_AUTH_SECRET があるときだけ作動し、
 * 署名Cookieが無い/無効なリクエストを /gate へリダイレクトする。
 * 公開パス（/gate, /api/gate, /cal/* = ICS配信）と静的アセットは素通し。
 */
export async function middleware(req: NextRequest) {
  if (!isGateEnabled()) return NextResponse.next();

  const { pathname, search } = req.nextUrl;
  if (isPublicPath(pathname)) return NextResponse.next();

  const token = req.cookies.get(GATE_COOKIE)?.value;
  if (await verifyToken(getAuthSecret(), token)) return NextResponse.next();

  const url = req.nextUrl.clone();
  url.pathname = "/gate";
  url.search = "";
  url.searchParams.set("next", pathname + search);
  return NextResponse.redirect(url);
}

export const config = {
  // 静的アセット・画像最適化・各種メタファイルは除外（拡張子付きも除外）。
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|txt|xml|webmanifest|json)$).*)",
  ],
};
