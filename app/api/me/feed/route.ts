import { NextResponse } from "next/server";
import { isGoogleConfigured } from "@/lib/google/oauth";
import { getSession } from "@/lib/session";
import { ensureIcsToken, regenerateIcsToken } from "@/lib/feed";

/** カレンダー購読URLの取得（GET・初回はトークン生成）と再生成（POST） */

function feedUrl(token: string): string {
  const base = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  return `${base}/cal/${token}.ics`;
}

export async function GET() {
  if (!isGoogleConfigured()) {
    return NextResponse.json({ url: feedUrl("demo"), demo: true });
  }
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    const token = await ensureIcsToken(session.userId);
    return NextResponse.json({ url: feedUrl(token), demo: false });
  } catch (e) {
    console.error("[me/feed GET]", e);
    return NextResponse.json({ error: "feed_failed" }, { status: 500 });
  }
}

export async function POST() {
  if (!isGoogleConfigured()) {
    return NextResponse.json({ url: feedUrl("demo"), demo: true });
  }
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    const token = await regenerateIcsToken(session.userId);
    return NextResponse.json({ url: feedUrl(token), demo: false });
  } catch (e) {
    console.error("[me/feed POST]", e);
    return NextResponse.json({ error: "regenerate_failed" }, { status: 500 });
  }
}
