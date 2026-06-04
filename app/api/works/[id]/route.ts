import { NextRequest, NextResponse } from "next/server";
import { getDataProvider } from "@/lib/data/provider";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const work = await (await getDataProvider()).getWork(id);
  if (!work) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json(work);
}
