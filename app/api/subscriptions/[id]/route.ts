import { NextRequest, NextResponse } from "next/server";
import { isGoogleConfigured } from "@/lib/google/oauth";
import { getSession } from "@/lib/session";

/** body[k] を「空でない文字列の配列」に正規化する。配列でなければ undefined。 */
function sanitizeChannels(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const out: string[] = [];
  const seen = new Set<string>();
  for (const v of value) {
    if (typeof v !== "string") continue;
    const name = v.trim();
    if (!name || seen.has(name)) continue;
    seen.add(name);
    out.push(name);
  }
  return out;
}

/** 列欠如（pre-migration）由来のエラーか判定する。 */
function isMissingChannelsColumn(error: { message?: string; code?: string } | null): boolean {
  if (!error) return false;
  const msg = (error.message ?? "").toLowerCase();
  // Postgres: 42703 = undefined_column
  return error.code === "42703" || (msg.includes("channels") && msg.includes("column"));
}

/** 登録の変更（一時停止/形式変更/放送局上書き） */
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
    channels: "channels",
  };
  const update: Record<string, unknown> = {};
  for (const [k, col] of Object.entries(allowed)) {
    if (!(k in body)) continue;
    // channels は配列に正規化（pre-migration では列が無い可能性があるので別扱い）
    if (col === "channels") {
      const clean = sanitizeChannels(body[k]);
      if (clean !== undefined) update[col] = clean;
      continue;
    }
    update[col] = body[k];
  }
  if (Object.keys(update).length === 0) return NextResponse.json({ error: "no_fields" }, { status: 400 });

  const { getAdminClient } = await import("@/lib/supabase/admin");
  const db = getAdminClient();

  const runUpdate = (row: Record<string, unknown>) =>
    db.from("subscriptions").update(row).eq("id", id).eq("user_id", session.userId);

  let { error } = await runUpdate(update);
  // channels 列が無い（migration 0010 未適用）場合は channels を外して再試行。
  // それ以外の項目だけでも反映できるようにする。
  if (error && "channels" in update && isMissingChannelsColumn(error)) {
    const { channels: _omit, ...rest } = update;
    void _omit;
    if (Object.keys(rest).length === 0) {
      // 放送局だけの更新だった → 列が無いので何もできないが、エラーにはしない（pre-migration 安全）。
      return NextResponse.json({ ok: true, skippedChannels: true });
    }
    ({ error } = await runUpdate(rest));
  }
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
