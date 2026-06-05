import { NextRequest, NextResponse } from "next/server";
import { isGoogleConfigured } from "@/lib/google/oauth";
import { getSession } from "@/lib/session";
import { getAccessTokenForSession } from "@/lib/accounts";
import { getDataProvider } from "@/lib/data/provider";
import { syncSubscription } from "@/lib/sync/syncCalendars";
import { pickOnePerEpisode } from "@/lib/programs";
import type { Program, Subscription, SubscriptionMode } from "@/lib/types";

const HORIZON_DAYS = 120;

interface Body {
  workId: string;
  googleCalendarId: string;
  mode?: SubscriptionMode;
  includeSubtitle?: boolean;
  includeChannel?: boolean;
  includeUrl?: boolean;
}

function countFuturePrograms(programs: Program[]): number {
  const now = Date.now();
  const horizon = now + HORIZON_DAYS * 86400000;
  const inWindow = programs.filter((p) => {
    const t = new Date(p.startAt).getTime();
    return t >= now - 86400000 && t <= horizon && !p.isRebroadcast;
  });
  // 系列局の同時ネットは1話1件に集約して数える
  return pickOnePerEpisode(inWindow).length;
}

export async function POST(req: NextRequest) {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? req.nextUrl.origin;
  let body: Body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }
  if (!body.workId || !body.googleCalendarId) {
    return NextResponse.json({ error: "missing_fields" }, { status: 400 });
  }

  const provider = await getDataProvider();
  const work = await provider.getWork(body.workId);
  if (!work) return NextResponse.json({ error: "work_not_found" }, { status: 404 });

  // --- デモモード（Google未設定）: 実登録せず、登録される件数を返す ---
  if (!isGoogleConfigured()) {
    return NextResponse.json({
      created: countFuturePrograms(work.programs),
      updated: 0,
      demo: true,
    });
  }

  // --- 本番: 認証必須 ---
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { getAdminClient } = await import("@/lib/supabase/admin");
  const db = getAdminClient();

  // 購読の upsert（重複登録防止: unique(user_id, work_id, google_calendar_id)）
  const subRow = {
    user_id: session.userId,
    work_id: body.workId,
    google_calendar_id: body.googleCalendarId,
    mode: body.mode ?? "per_episode",
    include_subtitle: body.includeSubtitle ?? true,
    include_channel: body.includeChannel ?? true,
    include_url: body.includeUrl ?? true,
    auto_sync: true,
    status: "active",
  };
  const { data: upserted, error } = await db
    .from("subscriptions")
    .upsert(subRow, { onConflict: "user_id,work_id,google_calendar_id" })
    .select()
    .single();
  if (error || !upserted) {
    console.error("[subscriptions.upsert]", error);
    return NextResponse.json({ error: "subscription_failed" }, { status: 500 });
  }

  const sub: Subscription = {
    id: upserted.id,
    userId: upserted.user_id,
    workId: upserted.work_id,
    googleCalendarId: upserted.google_calendar_id,
    mode: upserted.mode,
    includeSubtitle: upserted.include_subtitle,
    includeChannel: upserted.include_channel,
    includeUrl: upserted.include_url,
    autoSync: upserted.auto_sync,
    status: upserted.status,
    createdAt: upserted.created_at,
  };

  try {
    const accessToken = await getAccessTokenForSession(session);
    if (!accessToken) return NextResponse.json({ error: "no_token" }, { status: 401 });
    const result = await syncSubscription(sub, accessToken, appUrl);
    return NextResponse.json({ ...result, subscriptionId: sub.id, demo: false });
  } catch (e) {
    console.error("[subscriptions.sync]", e);
    return NextResponse.json({ error: "calendar_write_failed" }, { status: 502 });
  }
}

export async function GET() {
  if (!isGoogleConfigured()) return NextResponse.json({ subscriptions: [], demo: true });
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { getAdminClient } = await import("@/lib/supabase/admin");
  const db = getAdminClient();
  const { data } = await db
    .from("subscriptions")
    .select("*, works(title, key_visual_url)")
    .eq("user_id", session.userId)
    .neq("status", "cancelled")
    .order("created_at", { ascending: false });
  return NextResponse.json({ subscriptions: data ?? [], demo: false });
}
