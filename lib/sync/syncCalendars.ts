import { getAdminClient } from "@/lib/supabase/admin";
import { getDataProvider } from "@/lib/data/provider";
import { buildEvent } from "./eventBuilder";
import { insertEvent, patchEvent } from "@/lib/google/calendar";
import { getAccessTokenForSession } from "@/lib/accounts";
import { pickOnePerEpisode } from "@/lib/programs";
import type { Subscription } from "@/lib/types";

/** 何日先までの放送回を登録対象にするか */
const HORIZON_DAYS = 120;

export interface SyncResult {
  created: number;
  updated: number;
  failed: number;
}

function rowToSubscription(row: any): Subscription {
  return {
    id: row.id,
    userId: row.user_id,
    workId: row.work_id,
    googleCalendarId: row.google_calendar_id,
    mode: row.mode,
    includeSubtitle: row.include_subtitle,
    includeChannel: row.include_channel,
    includeUrl: row.include_url,
    autoSync: row.auto_sync,
    status: row.status,
    createdAt: row.created_at,
  };
}

/**
 * 1つの購読(subscription)について、未来の放送回をカレンダーへ反映する。
 * - 台帳(calendar_events)に無い回は新規作成（重複防止）。
 * - 既にある回は content_hash を比較し、変化していれば更新（サブタイトル後追い・時間変更に対応）。
 */
export async function syncSubscription(
  sub: Subscription,
  accessToken: string,
  appUrl: string,
): Promise<SyncResult> {
  const db = getAdminClient();
  const provider = await getDataProvider();
  const work = await provider.getWork(sub.workId);
  const result: SyncResult = { created: 0, updated: 0, failed: 0 };
  if (!work) return result;

  const now = Date.now();
  const horizon = now + HORIZON_DAYS * 86400000;
  const inWindow = work.programs.filter((p) => {
    const t = new Date(p.startAt).getTime();
    return t >= now - 86400000 && t <= horizon && !p.isRebroadcast;
  });
  // 系列局での同時ネット放送がある作品は、1話につき1件だけ登録する
  // （同じ話数の中で最も早い放送＝通常キー局を代表に選ぶ）。これでカレンダーの重複を防ぐ。
  const targets = pickOnePerEpisode(inWindow);

  const { data: existingRows } = await db
    .from("calendar_events")
    .select("id, program_id, google_event_id, content_hash, status")
    .eq("subscription_id", sub.id);
  const byProgram = new Map<string, any>((existingRows ?? []).map((e) => [e.program_id, e]));

  for (const program of targets) {
    const episode = work.episodes.find((e) => e.id === program.episodeId) ?? null;
    const { input, contentHash } = buildEvent(work, program, episode, sub, appUrl);
    const ledger = byProgram.get(program.id);

    try {
      if (!ledger) {
        // 新規（重複防止: unique(subscription_id, program_id) で二重作成も防止）
        const { id } = await insertEvent(accessToken, sub.googleCalendarId, input);
        await db.from("calendar_events").insert({
          subscription_id: sub.id,
          program_id: program.id,
          google_calendar_id: sub.googleCalendarId,
          google_event_id: id,
          status: "created",
          content_hash: contentHash,
          synced_at: new Date().toISOString(),
        });
        result.created++;
      } else if (ledger.google_event_id && ledger.content_hash !== contentHash) {
        // 内容変化（サブタイトル判明・放送時間変更など）→ 更新
        await patchEvent(accessToken, sub.googleCalendarId, ledger.google_event_id, input);
        await db
          .from("calendar_events")
          .update({ content_hash: contentHash, status: "updated", synced_at: new Date().toISOString() })
          .eq("id", ledger.id);
        result.updated++;
      }
    } catch (e) {
      console.error(`[sync] sub=${sub.id} program=${program.id}`, e);
      result.failed++;
      if (ledger) {
        await db.from("calendar_events").update({ status: "failed" }).eq("id", ledger.id);
      }
    }
  }

  return result;
}

/**
 * cronから呼ぶ全体同期。active かつ auto_sync の購読を処理する。
 */
export async function syncAllSubscriptions(appUrl: string): Promise<SyncResult & { subscriptions: number }> {
  const db = getAdminClient();
  const total: SyncResult & { subscriptions: number } = {
    created: 0,
    updated: 0,
    failed: 0,
    subscriptions: 0,
  };

  const runStart = new Date().toISOString();

  const { data: subs } = await db
    .from("subscriptions")
    .select("*")
    .eq("status", "active")
    .eq("auto_sync", true);

  // ユーザーごとにアクセストークンを使い回す
  const tokenCache = new Map<string, string | null>();

  for (const row of subs ?? []) {
    const sub = rowToSubscription(row);
    total.subscriptions++;
    let accessToken = tokenCache.get(sub.userId) ?? null;
    if (!tokenCache.has(sub.userId)) {
      accessToken = await getAccessTokenForSession({ userId: sub.userId, email: "" }).catch(() => null);
      tokenCache.set(sub.userId, accessToken);
    }
    if (!accessToken) {
      // トークン失効 → 購読を一時停止し、次回ログイン時に再同意を促す（docs/06）
      await db.from("subscriptions").update({ status: "paused" }).eq("id", sub.id);
      continue;
    }
    const r = await syncSubscription(sub, accessToken, appUrl);
    total.created += r.created;
    total.updated += r.updated;
    total.failed += r.failed;
  }

  await db.from("sync_runs").insert({
    started_at: runStart,
    finished_at: new Date().toISOString(),
    status: "ok",
    created_count: total.created,
    updated_count: total.updated,
    error_count: total.failed,
    note: `subscriptions=${total.subscriptions}`,
  });

  return total;
}
