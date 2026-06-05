import crypto from "node:crypto";

/**
 * Googleの sub（数値文字列の一意ID）から、決定的なUUIDを生成する。
 * DBのユーザーID列が uuid 型のため、同じGoogleアカウントなら常に同じUUIDになるよう変換する。
 * （UUID v5 相当: sha256ハッシュを 8-4-4-4-12 に整形し version=5 / variant を固定）
 */
export function googleSubToUserId(sub: string): string {
  const h = crypto.createHash("sha256").update(`google:${sub}`).digest("hex");
  const variant = ((parseInt(h[16], 16) & 0x3) | 0x8).toString(16);
  return [
    h.slice(0, 8),
    h.slice(8, 12),
    `5${h.slice(13, 16)}`,
    `${variant}${h.slice(17, 20)}`,
    h.slice(20, 32),
  ].join("-");
}
