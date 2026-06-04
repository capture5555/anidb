import crypto from "node:crypto";

/**
 * AES-256-GCM による暗号化ユーティリティ。
 * - リフレッシュトークンの暗号化保存（TOKEN_ENCRYPTION_KEY）
 * - セッションCookieの暗号化（SESSION_SECRET から鍵導出）
 * に使う。
 */

function keyFromHex(hex: string): Buffer {
  const buf = Buffer.from(hex, "hex");
  if (buf.length !== 32) throw new Error("encryption key must be 32 bytes (64 hex chars)");
  return buf;
}

function keyFromSecret(secret: string): Buffer {
  // 任意長のシークレットから32バイト鍵を導出
  return crypto.createHash("sha256").update(secret).digest();
}

export function encryptWithKey(plaintext: string, key: Buffer): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  // iv.tag.cipher を base64url で連結
  return `${iv.toString("base64url")}.${tag.toString("base64url")}.${enc.toString("base64url")}`;
}

export function decryptWithKey(payload: string, key: Buffer): string {
  const [ivB, tagB, encB] = payload.split(".");
  if (!ivB || !tagB || !encB) throw new Error("malformed ciphertext");
  const iv = Buffer.from(ivB, "base64url");
  const tag = Buffer.from(tagB, "base64url");
  const enc = Buffer.from(encB, "base64url");
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString("utf8");
}

// --- トークン暗号化（DB保存用） ---

export function getTokenKey(): Buffer {
  const hex = process.env.TOKEN_ENCRYPTION_KEY;
  if (!hex) throw new Error("TOKEN_ENCRYPTION_KEY is not set");
  return keyFromHex(hex);
}

export function encryptToken(token: string): string {
  return encryptWithKey(token, getTokenKey());
}

export function decryptToken(payload: string): string {
  return decryptWithKey(payload, getTokenKey());
}

// --- セッション暗号化（Cookie用） ---

let sessionKeyCache: Buffer | null = null;

export function getSessionKey(): Buffer {
  if (sessionKeyCache) return sessionKeyCache;
  const secret = process.env.SESSION_SECRET ?? "dev-insecure-session-secret-change-me";
  sessionKeyCache = keyFromSecret(secret);
  return sessionKeyCache;
}
