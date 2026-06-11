import { NextRequest, NextResponse } from "next/server";
import { isGoogleConfigured } from "@/lib/google/oauth";
import { getSession } from "@/lib/session";
import { getUserChannels, setUserChannels } from "@/lib/userChannels";

/** ユーザーの「視聴できる放送局」設定の取得(GET)・保存(PUT)。 */

interface Body {
  channels?: unknown;
}

function sanitize(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const v of input) {
    if (typeof v !== "string") continue;
    const name = v.trim();
    if (!name || seen.has(name)) continue;
    seen.add(name);
    out.push(name);
  }
  return out;
}

export async function GET() {
  if (!isGoogleConfigured()) return NextResponse.json({ channels: [], demo: true });
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  // getUserChannels は列未作成でも防御的に [] を返す
  const channels = await getUserChannels(session.userId);
  return NextResponse.json({ channels, demo: false });
}

export async function PUT(req: NextRequest) {
  if (!isGoogleConfigured()) return NextResponse.json({ channels: [], demo: true });
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let body: Body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  const channels = sanitize(body.channels);
  // setUserChannels は列未作成でも防御的にサイレント無視する
  await setUserChannels(session.userId, channels);
  return NextResponse.json({ channels, demo: false });
}
