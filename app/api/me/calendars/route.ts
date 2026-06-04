import { NextResponse } from "next/server";
import { isGoogleConfigured } from "@/lib/google/oauth";
import { listCalendars } from "@/lib/google/calendar";
import { getSession } from "@/lib/session";
import { getAccessTokenForSession } from "@/lib/accounts";
import type { GoogleCalendarInfo } from "@/lib/types";

const DEMO_CALENDARS: GoogleCalendarInfo[] = [
  { id: "primary", summary: "個人カレンダー", primary: true, accessRole: "owner" },
  { id: "team@group.calendar.google.com", summary: "会社共有カレンダー", primary: false, accessRole: "writer" },
  { id: "project@group.calendar.google.com", summary: "プロジェクト用カレンダー", primary: false, accessRole: "writer" },
];

export async function GET() {
  // Google未設定: デモのカレンダー一覧を返す（流れの確認用）
  if (!isGoogleConfigured()) {
    return NextResponse.json({ calendars: DEMO_CALENDARS, demo: true });
  }

  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const accessToken = await getAccessTokenForSession(session);
    if (!accessToken) {
      return NextResponse.json({ error: "no_token" }, { status: 401 });
    }
    const calendars = await listCalendars(accessToken);
    return NextResponse.json({ calendars, demo: false });
  } catch (e) {
    console.error("[me/calendars]", e);
    return NextResponse.json({ error: "calendar_fetch_failed" }, { status: 502 });
  }
}
