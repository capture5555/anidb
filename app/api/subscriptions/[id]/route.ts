import { NextRequest, NextResponse } from "next/server";
import { isGoogleConfigured } from "@/lib/google/oauth";
import { getSession } from "@/lib/session";
import { getAccessTokenForSession } from "@/lib/accounts";
import { deleteEvent } from "@/lib/google/calendar";

/** 登録の変更（カレンダー変更/一時停止/形式変更） */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!isGoogleConfigured()) return NextResponse.json({ ok: true, demo: true });
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  const body = await req.json().catch(() => ({}));

  const allowed: Record<string, string> = {
    mode: "mode",
    status: "status",
    autoSync: "auto_sync",
    includeSubtitle: "include_subtitle",
    includeChannel: "include_channel",
    includeUrl: "include_url",
    googleCalendarId: "google_calendar_id",
  };
  const update: Record<string, unknown> = {};
  for (const [k, col] of Object.entries(allowed)) {
    if (k in body) update[col] = body[k];
  }
  if (Object.keys(update).length === 0) return NextResponse.json({ error: "no_fields" }, { status: 400 });

  const { getAdminClient } = await import("@/lib/supabase/admin");
  const db = getAdminClient();
  const { error } = await db.from("subscriptions").update(update).eq("id", id).eq("user_id", session.userId);
  if (error) return NextResponse.json({ error: "update_failed" }, { status: 500 });
  return NextResponse.json({ ok: true });
}

/** 登録解除。?removeEvents=1 でカレンダー上のイベントも削除 */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!isGoogleConfigured()) return NextResponse.json({ ok: true, demo: true });
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  const removeEvents = req.nextUrl.searchParams.get("removeEvents") === "1";

  const { getAdminClient } = await import("@/lib/supabase/admin");
  const db = getAdminClient();

  // 本人の購読か確認
  const { data: sub } = await db
    .from("subscriptions")
    .select("id, user_id, google_calendar_id")
    .eq("id", id)
    .eq("user_id", session.userId)
    .maybeSingle();
  if (!sub) return NextResponse.json({ error: "not_found" }, { status: 404 });

  if (removeEvents) {
    try {
      const accessToken = await getAccessTokenForSession(session);
      const { data: events } = await db
        .from("calendar_events")
        .select("google_event_id")
        .eq("subscription_id", id);
      if (accessToken) {
        for (const ev of events ?? []) {
          if (ev.google_event_id) {
            await deleteEvent(accessToken, sub.google_calendar_id, ev.google_event_id).catch(() => {});
          }
        }
      }
    } catch (e) {
      console.error("[subscriptions.delete events]", e);
    }
  }

  await db.from("subscriptions").update({ status: "cancelled" }).eq("id", id);
  return NextResponse.json({ ok: true });
}
