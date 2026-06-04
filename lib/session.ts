import { cookies } from "next/headers";
import { encryptWithKey, decryptWithKey, getSessionKey } from "./crypto";

const COOKIE = "anidb_session";
const MAX_AGE = 60 * 60 * 24 * 30; // 30日

export interface SessionData {
  userId: string; // Supabase上のユーザーID（demoではgoogle_subやemailを流用）
  email: string;
  /**
   * デモ/Supabase未設定時に限り、リフレッシュトークンをセッションに保持する。
   * Supabase利用時はDB(google_accounts)に保存し、ここには入れない。
   */
  refreshToken?: string;
}

export async function getSession(): Promise<SessionData | null> {
  const store = await cookies();
  const raw = store.get(COOKIE)?.value;
  if (!raw) return null;
  try {
    const json = decryptWithKey(raw, getSessionKey());
    return JSON.parse(json) as SessionData;
  } catch {
    return null;
  }
}

export async function setSession(data: SessionData): Promise<void> {
  const store = await cookies();
  const enc = encryptWithKey(JSON.stringify(data), getSessionKey());
  store.set(COOKIE, enc, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: MAX_AGE,
  });
}

export async function clearSession(): Promise<void> {
  const store = await cookies();
  store.delete(COOKIE);
}

// OAuthのstate(CSRF対策)用の短命Cookie
const STATE_COOKIE = "anidb_oauth";

export async function setOAuthState(state: string, returnTo: string): Promise<void> {
  const store = await cookies();
  const enc = encryptWithKey(JSON.stringify({ state, returnTo }), getSessionKey());
  store.set(STATE_COOKIE, enc, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 600, // 10分
  });
}

export async function consumeOAuthState(): Promise<{ state: string; returnTo: string } | null> {
  const store = await cookies();
  const raw = store.get(STATE_COOKIE)?.value;
  if (!raw) return null;
  store.delete(STATE_COOKIE);
  try {
    return JSON.parse(decryptWithKey(raw, getSessionKey()));
  } catch {
    return null;
  }
}
