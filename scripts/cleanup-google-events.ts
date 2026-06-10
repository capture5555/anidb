/**
 * 【移行前に1回だけ実行】旧OAuth時代にアプリが作成したGoogleカレンダーの予定を全削除する。
 *
 *   npm run cleanup-google-events -- --dry-run   # 何件消すかを表示するだけ（削除しない）
 *   npm run cleanup-google-events                # 実際に削除する
 *
 * 実行順序（厳守）:
 *   1. このスクリプトを dry-run で確認 → 本実行
 *   2. その後に supabase/migrations/0006_ics_feed.sql を適用
 *      （0006 は refresh_token_encrypted と calendar_events を破棄するため、先に消すと二度と掃除できない）
 *
 * ICS移行後に lib/google/calendar.ts 等の旧コードは削除されるため、
 * このスクリプトは lib に依存せず自己完結で実装している（暗号復号・トークン更新・削除APIを内蔵）。
 */
import { readFileSync } from "node:fs";
import crypto from "node:crypto";

// .env.local を手動ロード（scripts/ingest.ts と同じ方式）
try {
  const env = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
  for (const line of env.split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
} catch {
  /* 環境変数があれば動く */
}

import { createClient } from "@supabase/supabase-js";

const DRY_RUN = process.argv.includes("--dry-run");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// --- AES-256-GCM 復号（旧 lib/crypto.ts の decryptToken と同一形式: iv.tag.cipher の base64url 連結） ---
function decryptToken(payload: string): string {
  const hex = process.env.TOKEN_ENCRYPTION_KEY;
  if (!hex) throw new Error("TOKEN_ENCRYPTION_KEY is not set");
  const key = Buffer.from(hex, "hex");
  if (key.length !== 32) throw new Error("TOKEN_ENCRYPTION_KEY must be 32 bytes (64 hex chars)");
  const [ivB, tagB, encB] = payload.split(".");
  if (!ivB || !tagB || !encB) throw new Error("malformed ciphertext");
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(ivB, "base64url"));
  decipher.setAuthTag(Buffer.from(tagB, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(encB, "base64url")), decipher.final()]).toString("utf8");
}

// --- リフレッシュトークン → アクセストークン ---
async function refreshAccessToken(refreshToken: string): Promise<string | null> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) {
    console.warn(`  token refresh failed: ${res.status} ${await res.text()}`);
    return null;
  }
  const json = (await res.json()) as { access_token: string };
  return json.access_token;
}

// --- イベント削除（404/410=既に無い は成功扱い） ---
async function deleteEvent(accessToken: string, calendarId: string, eventId: string): Promise<boolean> {
  const res = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
    { method: "DELETE", headers: { Authorization: `Bearer ${accessToken}` } },
  );
  if (res.status === 429) {
    await sleep(2000);
    return deleteEvent(accessToken, calendarId, eventId);
  }
  return res.ok || res.status === 404 || res.status === 410;
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY が必要です");
  const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

  // 台帳から削除対象を取得（subscription 経由で user_id を引く）
  const { data: events, error } = await db
    .from("calendar_events")
    .select("id, google_calendar_id, google_event_id, subscriptions(user_id)")
    .not("google_event_id", "is", null);
  if (error) throw error;

  type Row = { id: string; google_calendar_id: string; google_event_id: string; userId: string };
  const rows: Row[] = (events ?? [])
    .map((e: any) => ({
      id: e.id,
      google_calendar_id: e.google_calendar_id,
      google_event_id: e.google_event_id,
      userId: e.subscriptions?.user_id,
    }))
    .filter((r) => r.userId);

  const byUser = new Map<string, Row[]>();
  for (const r of rows) {
    if (!byUser.has(r.userId)) byUser.set(r.userId, []);
    byUser.get(r.userId)!.push(r);
  }

  console.log(`削除対象: ${rows.length} 件（${byUser.size} ユーザー）${DRY_RUN ? "  ※ dry-run（削除しません）" : ""}`);

  let deleted = 0;
  let skippedUsers = 0;
  let failed = 0;

  for (const [userId, userRows] of byUser) {
    // ユーザーのリフレッシュトークン（まだ有効なもの）でアクセストークンを得る
    const { data: ga } = await db
      .from("google_accounts")
      .select("refresh_token_encrypted")
      .eq("user_id", userId)
      .maybeSingle();
    if (!ga?.refresh_token_encrypted) {
      console.warn(`user=${userId}: トークン無し → ${userRows.length} 件スキップ（手動削除が必要）`);
      skippedUsers++;
      continue;
    }
    let accessToken: string | null = null;
    try {
      accessToken = await refreshAccessToken(decryptToken(ga.refresh_token_encrypted));
    } catch (e) {
      console.warn(`user=${userId}: 復号/更新失敗`, e);
    }
    if (!accessToken) {
      console.warn(`user=${userId}: トークン失効 → ${userRows.length} 件スキップ（手動削除が必要）`);
      skippedUsers++;
      continue;
    }

    for (const r of userRows) {
      if (DRY_RUN) {
        deleted++;
        continue;
      }
      const ok = await deleteEvent(accessToken, r.google_calendar_id, r.google_event_id);
      if (ok) {
        deleted++;
        await db.from("calendar_events").update({ status: "deleted" }).eq("id", r.id);
      } else {
        failed++;
        console.warn(`  delete failed: calendar=${r.google_calendar_id} event=${r.google_event_id}`);
      }
      await sleep(150); // Calendar API のレート制限対策
    }
    console.log(`user=${userId}: ${userRows.length} 件処理`);
  }

  console.log(
    `\n完了: ${DRY_RUN ? "削除予定" : "削除"} ${deleted} 件 / 失敗 ${failed} 件 / トークン無しユーザー ${skippedUsers}`,
  );
  if (!DRY_RUN && failed === 0 && skippedUsers === 0) {
    console.log("→ 次は supabase/migrations/0006_ics_feed.sql を適用してください。");
  }
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
