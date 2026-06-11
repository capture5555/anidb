/**
 * サイト入口パスワードゲートの共通ロジック（Edge 互換: Web Crypto のみ。node:crypto 不使用）。
 *
 * - ミドルウェア(middleware.ts)は「署名Cookieの検証」だけを行う（DBアクセスなし＝高速）。
 * - パスワード照合と used_count 加算は /api/gate (POST) でのみ行う。
 *
 * ゲートは SITE_GATE_ENABLED=1 かつ SITE_AUTH_SECRET があるときだけ有効。
 * どちらか欠けていれば無効（＝従来どおり全公開。設定前にロックアウトしない）。
 */

export const GATE_COOKIE = "site_gate";
/** セッション有効期間（ログイン1回ぶん）。 */
export const GATE_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30日

/** ゲートを通さない公開パス（前方一致 or 完全一致）。 */
const PUBLIC_PREFIXES = ["/gate", "/api/gate", "/cal/"];

export function isPublicPath(pathname: string): boolean {
  return PUBLIC_PREFIXES.some((p) => pathname === p || pathname.startsWith(p));
}

export function getAuthSecret(): string {
  return process.env.SITE_AUTH_SECRET ?? "";
}

/** ゲートが有効か（フラグ＋シークレットが揃っているか）。 */
export function isGateEnabled(): boolean {
  const flag = (process.env.SITE_GATE_ENABLED ?? "").toLowerCase();
  const on = flag === "1" || flag === "true" || flag === "yes" || flag === "on";
  return on && getAuthSecret().length > 0;
}

const encoder = new TextEncoder();

function bytesToBase64Url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function hmac(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(message));
  return bytesToBase64Url(new Uint8Array(sig));
}

/** 一定時間比較（早期 return しない簡易版）。 */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** 署名トークンを発行する。形式 `${expMs}.${sig}`。 */
export async function signToken(secret: string, expMs: number): Promise<string> {
  const sig = await hmac(secret, String(expMs));
  return `${expMs}.${sig}`;
}

/** 署名トークンを検証する（署名一致 かつ 未失効）。 */
export async function verifyToken(secret: string, token: string | undefined): Promise<boolean> {
  if (!secret || !token) return false;
  const dot = token.indexOf(".");
  if (dot <= 0) return false;
  const expStr = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expMs = Number(expStr);
  if (!Number.isFinite(expMs) || expMs < Date.now()) return false;
  const expected = await hmac(secret, expStr);
  return timingSafeEqual(sig, expected);
}

/** redirect 先を内部パスだけに制限する（オープンリダイレクト防止）。 */
export function safeNextPath(next: string | null | undefined): string {
  if (!next) return "/";
  // 内部の絶対パスのみ許可（"//" や "http" 始まりは拒否）。
  if (!next.startsWith("/") || next.startsWith("//")) return "/";
  return next;
}
