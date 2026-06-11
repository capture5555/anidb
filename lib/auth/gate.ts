/**
 * サイト入口パスワードゲート（パスワードのみ・ユーザー名なし）。Edge 互換（Web Crypto のみ）。
 *
 * 管理は Cloudflare 環境変数 SITE_PASSWORD だけ。これが設定されているときだけ作動し、
 * 未設定なら従来どおり全公開（ロックアウト防止）。
 *
 * - ミドルウェアは「署名Cookieの検証」だけ（高速）。
 * - パスワード照合は /api/gate (POST) で行い、合致したら署名Cookieを発行する。
 * - Cookie の署名鍵には SITE_PASSWORD 自体を使う（別シークレット不要。パスワードを変えれば
 *   既存セッションも自動的に無効化される）。
 */

export const GATE_COOKIE = "site_gate";
/** セッション有効期間。 */
export const GATE_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30日

/**
 * ゲートを通さない公開パス。
 * /gate・/api/gate は完全一致（/gateway 等を誤って公開しないため）。/cal/ は前方一致（ICS配信）。
 */
export function isPublicPath(pathname: string): boolean {
  if (pathname === "/gate" || pathname === "/api/gate") return true;
  if (pathname.startsWith("/cal/")) return true;
  return false;
}

function gatePassword(): string {
  return process.env.SITE_PASSWORD ?? "";
}

/** SITE_PASSWORD が設定されていればゲート有効。 */
export function isGateEnabled(): boolean {
  return gatePassword().length > 0;
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

/** 一定時間比較。 */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** 入力パスワードが SITE_PASSWORD と一致するか。 */
export function checkPassword(input: string): boolean {
  const p = gatePassword();
  return p.length > 0 && timingSafeEqual(input, p);
}

/** 署名トークン `${expMs}.${sig}` を発行（鍵=SITE_PASSWORD）。 */
export async function signToken(expMs: number): Promise<string> {
  const sig = await hmac(gatePassword(), String(expMs));
  return `${expMs}.${sig}`;
}

/** 署名トークンを検証（署名一致 かつ 未失効。鍵=SITE_PASSWORD）。 */
export async function verifyToken(token: string | undefined): Promise<boolean> {
  const secret = gatePassword();
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

/** redirect 先を内部パスだけに制限（オープンリダイレクト防止）。 */
export function safeNextPath(next: string | null | undefined): string {
  if (!next) return "/";
  // 単一スラッシュ始まりの内部パスのみ許可。"//" や バックスラッシュ("/\\…")は
  // 一部ブラウザで外部URL扱いになるため拒否。制御文字も拒否。
  if (!next.startsWith("/")) return "/";
  if (next.startsWith("//") || next.includes("\\") || /[\x00-\x1f]/.test(next)) return "/";
  return next;
}
