import { NextRequest, NextResponse } from "next/server";
import { exchangeCode, fetchUserInfo } from "@/lib/google/oauth";
import { consumeOAuthState, setSession } from "@/lib/session";
import { saveGoogleAccount } from "@/lib/accounts";

export async function GET(req: NextRequest) {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? req.nextUrl.origin;
  const sp = req.nextUrl.searchParams;
  const code = sp.get("code");
  const state = sp.get("state");
  const error = sp.get("error");

  const saved = await consumeOAuthState();
  const returnTo = saved?.returnTo ?? "/";

  if (error || !code) {
    return NextResponse.redirect(`${appUrl}${returnTo}${returnTo.includes("?") ? "&" : "?"}auth=cancelled`);
  }
  // CSRF対策: stateの照合
  if (!saved || saved.state !== state) {
    return NextResponse.redirect(`${appUrl}/?auth=invalid_state`);
  }

  try {
    const token = await exchangeCode(code);
    const user = await fetchUserInfo(token.access_token);
    const { userId } = await saveGoogleAccount(user);

    await setSession({ userId, email: user.email });

    return NextResponse.redirect(`${appUrl}${returnTo}`);
  } catch (e) {
    console.error("[oauth callback]", e);
    return NextResponse.redirect(`${appUrl}${returnTo}${returnTo.includes("?") ? "&" : "?"}auth=error`);
  }
}
