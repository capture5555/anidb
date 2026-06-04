import { NextRequest, NextResponse } from "next/server";
import { isAuthorizedInternal } from "@/lib/internal-auth";
import { syncAllSubscriptions } from "@/lib/sync/syncCalendars";

export const maxDuration = 300;

export async function GET(req: NextRequest) {
  return run(req);
}
export async function POST(req: NextRequest) {
  return run(req);
}

async function run(req: NextRequest) {
  if (!isAuthorizedInternal(req)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? req.nextUrl.origin;
  try {
    const result = await syncAllSubscriptions(appUrl);
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    console.error("[internal/sync-calendars]", e);
    return NextResponse.json({ error: "sync_failed", detail: String(e) }, { status: 500 });
  }
}
