import { NextRequest, NextResponse } from "next/server";

/**
 * 指定した放送回の「ある1分間」に流れた実況コメントを時系列で返す。
 * 盛り上がりグラフで分を選んだとき、その時に何が流れていたかを表示するのに使う。
 *   GET /api/analytics/minute-comments?programId=<uuid>&minute=<n>
 * minute_offset は放送開始(start_at)からの分。コメントは posted_at で窓を切る。
 */
export const dynamic = "force-dynamic";

const MAX_COMMENTS = 150;

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const programId = sp.get("programId");
  const minute = Number(sp.get("minute"));
  if (!programId || !Number.isFinite(minute) || minute < 0) {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }

  if (process.env.DATA_PROVIDER !== "supabase" || !process.env.NEXT_PUBLIC_SUPABASE_URL) {
    return NextResponse.json({ minute, total: 0, comments: [], demo: true });
  }

  try {
    const { getAdminClient } = await import("@/lib/supabase/admin");
    const db = getAdminClient();

    const { data: prog } = await db
      .from("programs")
      .select("start_at")
      .eq("id", programId)
      .maybeSingle();
    if (!prog) return NextResponse.json({ error: "not_found" }, { status: 404 });

    const start = new Date(prog.start_at).getTime();
    const winStart = new Date(start + minute * 60_000).toISOString();
    const winEnd = new Date(start + (minute + 1) * 60_000).toISOString();

    const { data, error } = await db
      .from("analytics_jikkyo_comments")
      .select("content, posted_at")
      .eq("program_id", programId)
      .gte("posted_at", winStart)
      .lt("posted_at", winEnd)
      .order("posted_at", { ascending: true })
      .limit(MAX_COMMENTS + 1);
    if (error) throw error;

    const rows = data ?? [];
    const truncated = rows.length > MAX_COMMENTS;
    const comments = rows.slice(0, MAX_COMMENTS).map((r) => ({
      text: r.content as string,
      sec: Math.max(0, Math.round((new Date(r.posted_at).getTime() - start) / 1000) - minute * 60),
    }));

    return NextResponse.json({ minute, total: comments.length, truncated, comments });
  } catch (e) {
    console.error("[minute-comments]", e);
    return NextResponse.json({ error: "internal" }, { status: 500 });
  }
}
