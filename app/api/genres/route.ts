import { NextResponse } from "next/server";
import { getDataProvider } from "@/lib/data/provider";

export async function GET() {
  const genres = await (await getDataProvider()).listGenres();
  return NextResponse.json({ genres });
}
