import { NextRequest, NextResponse } from "next/server";
import { isGoogleConfigured } from "@/lib/google/oauth";
import { getSession } from "@/lib/session";

/** 登録の変更（一時停止/形式変更） */
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

/**
 * 登録解除。status を cancelled にするだけでよい。
 * フィードから外れるため、Googleカレンダー側の予定も次回フェッチ時（最大24時間程度）に自動で消える。
 */
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!isGoogleConfigured()) return NextResponse.json({ ok: true, demo: true });
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;

  const { getAdminClient } = await import("@/lib/supabase/admin");
  const db = getAdminClient();

  const { data: sub } = await db
    .from("subscriptions")
    .select("id")
    .eq("id", id)
    .eq("user_id", session.userId)
    .maybeSingle();
  if (!sub) return NextResponse.json({ error: "not_found" }, { status: 404 });

  await db.from("subscriptions").update({ status: "cancelled" }).eq("id", id);
  return NextResponse.json({ ok: true });
}
