import { NextRequest, NextResponse } from "next/server";
import { isGoogleConfigured } from "@/lib/google/oauth";
import { getSession } from "@/lib/session";
import { getDataProvider } from "@/lib/data/provider";
import { pickOnePerEpisode } from "@/lib/programs";
import { parseRegion, type Region } from "@/lib/regions";
import { setUserRegion } from "@/lib/userRegion";
import { seedChannelsFromRegion } from "@/lib/channels";
import type { Program, SubscriptionMode } from "@/lib/types";

const HORIZON_DAYS = 120;

interface Body {
  workId: string;
  mode?: SubscriptionMode;
  includeSubtitle?: boolean;
  includeChannel?: boolean;
  includeUrl?: boolean;
  region?: string;
}

/** フィードに載る予定の放送回数（登録直後のフィードバック表示用） */
function countFuturePrograms(programs: Program[], region: Region): number {
  const now = Date.now();
  const horizon = now + HORIZON_DAYS * 86400000;
  const inWindow = programs.filter((p) => {
    const t = new Date(p.startAt).getTime();
    return t >= now - 86400000 && t <= horizon && !p.isRebroadcast;
  });
  // 系列局の同時ネットは1話1件（地域の種から得た放送局セットの代表）に集約して数える
  return pickOnePerEpisode(inWindow, seedChannelsFromRegion(region)).length;
}

export async function POST(req: NextRequest) {
  let body: Body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }
  if (!body.workId) {
    return NextResponse.json({ error: "missing_fields" }, { status: 400 });
  }

  const region = parseRegion(body.region);
  const provider = await getDataProvider();
  const work = await provider.getWork(body.workId);
  if (!work) return NextResponse.json({ error: "work_not_found" }, { status: 404 });

  // --- デモモード（Google未設定）: 実登録せず、フィードに載る件数を返す ---
  if (!isGoogleConfigured()) {
    return NextResponse.json({
      created: countFuturePrograms(work.programs, region),
      demo: true,
    });
  }

  // --- 本番: 認証必須 ---
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { getAdminClient } = await import("@/lib/supabase/admin");
  const db = getAdminClient();

  // 購読の upsert（重複登録防止: unique(user_id, work_id)）
  // 解除済み(cancelled)の行があっても active へ戻す
  const subRow = {
    user_id: session.userId,
    work_id: body.workId,
    mode: body.mode ?? "per_episode",
    include_subtitle: body.includeSubtitle ?? true,
    include_channel: body.includeChannel ?? true,
    include_url: body.includeUrl ?? true,
    auto_sync: true,
    status: "active",
  };
  const { data: upserted, error } = await db
    .from("subscriptions")
    .upsert(subRow, { onConflict: "user_id,work_id" })
    .select()
    .single();
  if (error || !upserted) {
    console.error("[subscriptions.upsert]", error);
    return NextResponse.json({ error: "subscription_failed" }, { status: 500 });
  }

  // 放送地域をユーザー設定として保存（フィードの代表局選択に使う）
  await setUserRegion(session.userId, region);

  return NextResponse.json({
    created: countFuturePrograms(work.programs, region),
    subscriptionId: upserted.id,
    demo: false,
  });
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
