import { NextResponse } from "next/server";
import { getDataProvider } from "@/lib/data/provider";

export async function GET() {
  const seasons = await (await getDataProvider()).listSeasons();
  return NextResponse.json({ seasons });
}
