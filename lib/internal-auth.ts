import { NextRequest } from "next/server";

/**
 * 内部API（cronから呼ぶ）を保護する。
 * Authorization: Bearer <INTERNAL_API_SECRET> もしくは Vercel Cron の x-vercel-cron ヘッダを許可。
 */
export function isAuthorizedInternal(req: NextRequest): boolean {
  const secret = process.env.INTERNAL_API_SECRET;
  // Vercel Cron からの呼び出し
  if (req.headers.get("x-vercel-cron")) return true;
  if (!secret) return false;
  const auth = req.headers.get("authorization");
  return auth === `Bearer ${secret}`;
}
