import { NextRequest, NextResponse } from "next/server";
import { buildDemoFeed, buildUserFeed, getUserIdByToken } from "@/lib/feed";

/**
 * ICSフィード配信エンドポイント。
 * GoogleカレンダーなどがこのURLを定期的にフェッチして予定を同期する。
 *   /cal/{token}.ics （.ics サフィックスはあっても無くてもよい）
 * seedモードでは /cal/demo.ics でサンプルフィードを返す。
 */
export const dynamic = "force-dynamic";

const ICS_HEADERS = {
  "Content-Type": "text/calendar; charset=utf-8",
  // capability URL なので共有キャッシュに乗せない。
  // データは毎時更新されるので、ブラウザ等のキャッシュは短く（5分）して鮮度を優先。
  "Cache-Control": "private, max-age=300, must-revalidate",
};

function supabaseMode(): boolean {
  return process.env.DATA_PROVIDER === "supabase" && Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL);
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  let { token } = await params;
  if (token.endsWith(".ics")) token = token.slice(0, -4);

  try {
    if (!supabaseMode()) {
      if (token === "demo") {
        return new NextResponse(await buildDemoFeed(), { headers: ICS_HEADERS });
      }
      return new NextResponse("not found", { status: 404 });
    }

    const userId = await getUserIdByToken(token);
    if (!userId) return new NextResponse("not found", { status: 404 });

    return new NextResponse(await buildUserFeed(userId), { headers: ICS_HEADERS });
  } catch (e) {
    console.error("[cal feed]", e);
    return new NextResponse("internal error", { status: 500 });
  }
}
