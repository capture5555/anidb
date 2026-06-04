import { NextRequest, NextResponse } from "next/server";
import crypto from "node:crypto";
import { buildAuthUrl, isGoogleConfigured } from "@/lib/google/oauth";
import { setOAuthState } from "@/lib/session";

export async function GET(req: NextRequest) {
  const returnTo = req.nextUrl.searchParams.get("returnTo") ?? "/";
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? req.nextUrl.origin;

  if (!isGoogleConfigured()) {
    // Google未設定: 案内付きで戻す（デモではモーダル側がこのフローを使わない）
    return NextResponse.redirect(`${appUrl}${returnTo}${returnTo.includes("?") ? "&" : "?"}google=unconfigured`);
  }

  const state = crypto.randomBytes(16).toString("base64url");
  await setOAuthState(state, returnTo);
  return NextResponse.redirect(buildAuthUrl(state));
}
