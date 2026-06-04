import { NextRequest, NextResponse } from "next/server";
import { isAuthorizedInternal } from "@/lib/internal-auth";
import { ingestSeason } from "@/lib/sync/ingest";
import { seasonOf, nextSeason, seasonSlug } from "@/lib/season";

// 取り込みは時間がかかるため最大実行時間を延長（Vercel）
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

  // 対象シーズン: 指定が無ければ「今シーズン + 来シーズン」
  const sp = req.nextUrl.searchParams;
  let seasons: string[];
  if (sp.get("season")) {
    seasons = [sp.get("season")!];
  } else {
    const now = new Date();
    const cur = seasonOf(now);
    const nxt = nextSeason(cur.year, cur.season);
    seasons = [seasonSlug(cur.year, cur.season), seasonSlug(nxt.year, nxt.season)];
  }

  try {
    const results = [];
    for (const s of seasons) {
      results.push({ season: s, ...(await ingestSeason(s)) });
    }
    return NextResponse.json({ ok: true, results });
  } catch (e) {
    console.error("[internal/ingest]", e);
    return NextResponse.json({ error: "ingest_failed", detail: String(e) }, { status: 500 });
  }
}
