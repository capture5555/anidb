import { NextRequest, NextResponse } from "next/server";
import { isGoogleConfigured } from "@/lib/google/oauth";
import { getSession } from "@/lib/session";
import { getDataProvider } from "@/lib/data/provider";
import { pickOnePerEpisode } from "@/lib/programs";
import { parseRegion, type Region, isStreamingChannel } from "@/lib/regions";
import { setUserRegion } from "@/lib/userRegion";
import { seedChannelsFromRegion, RECOMMENDED_CHANNELS, channelRankBy } from "@/lib/channels";
import type { Program, SubscriptionMode } from "@/lib/types";

const HORIZON_DAYS = 120;

interface Body {
  workId: string;
  mode?: SubscriptionMode;
  includeSubtitle?: boolean;
  includeChannel?: boolean;
  includeUrl?: boolean;
  region?: string;
  channels?: string[];
}

/** body.channels を「空でない文字列の配列」に正規化する。配列でなければ undefined。 */
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
  const channels = sanitizeChannels(body.channels);

  const upsert = (row: Record<string, unknown>) =>
    db.from("subscriptions").upsert(row, { onConflict: "user_id,work_id" }).select().single();

  // channels 付きで試行。列が無い（migration 0010 未適用）場合は channels を外して再試行。
  let { data: upserted, error } =
    channels !== undefined
      ? await upsert({ ...subRow, channels })
      : await upsert(subRow);
  if (error && channels !== undefined && isMissingChannelsColumn(error)) {
    ({ data: upserted, error } = await upsert(subRow));
  }
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

/** この作品の放送局名（配信除く・重複除去・おすすめ順）を算出する。 */
function broadcastChannelNames(programs: Program[]): string[] {
  const seen = new Set<string>();
  const names: string[] = [];
  for (const p of programs) {
    const name = (p.channelName ?? "").trim();
    if (!name || isStreamingChannel(name) || seen.has(name)) continue;
    seen.add(name);
    names.push(name);
  }
  names.sort((a, b) => {
    const ra = channelRankBy(a, RECOMMENDED_CHANNELS);
    const rb = channelRankBy(b, RECOMMENDED_CHANNELS);
    return ra !== rb ? ra - rb : a.localeCompare(b);
  });
  return names;
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

  // 各購読に、その作品が放送される放送局の選択肢（channelOptions）を付与する。
  // マイページの放送局エディタは、この選択肢の中からだけ選べるようにする。
  const provider = await getDataProvider();
  const subscriptions = await Promise.all(
    (data ?? []).map(async (row) => {
      let channelOptions: string[] = [];
      try {
        const work = await provider.getWork(row.work_id);
        if (work) channelOptions = broadcastChannelNames(work.programs);
      } catch {
        channelOptions = [];
      }
      return { ...row, channelOptions };
    }),
  );
  return NextResponse.json({ subscriptions, demo: false });
}
