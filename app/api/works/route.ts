import { NextRequest, NextResponse } from "next/server";
import { getDataProvider } from "@/lib/data/provider";
import type { ListTab, WorkStatus } from "@/lib/types";

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const provider = await getDataProvider();
  const result = await provider.listWorks({
    tab: (sp.get("tab") as ListTab) ?? undefined,
    season: sp.get("season") ?? undefined,
    status: (sp.get("status") as WorkStatus) ?? undefined,
    genre: sp.get("genre") ?? undefined,
    q: sp.get("q") ?? undefined,
    page: sp.get("page") ? Number(sp.get("page")) : undefined,
    perPage: sp.get("perPage") ? Number(sp.get("perPage")) : undefined,
  });
  return NextResponse.json(result);
}
