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

  const sp = req.nextUrl.searchParams;
  const metaOnly = sp.get("meta") === "1";

  // 対象シーズンの決定
  let seasons: string[];
  if (sp.get("fromYear") && sp.get("toYear")) {
    // 過去データの範囲取り込み（分析用・metaOnly想定）
    const from = Number(sp.get("fromYear"));
    const to = Number(sp.get("toYear"));
    const names = ["winter", "spring", "summer", "autumn"];
    seasons = [];
    for (let y = from; y <= to; y++) for (const n of names) seasons.push(`${y}-${n}`);
  } else if (sp.get("season")) {
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
      results.push({ season: s, ...(await ingestSeason(s, { metaOnly })) });
    }
    return NextResponse.json({ ok: true, metaOnly, results });
  } catch (e) {
    console.error("[internal/ingest]", e);
    return NextResponse.json({ error: "ingest_failed", detail: String(e) }, { status: 500 });
  }
}
