import crypto from "node:crypto";
import { getAdminClient } from "./supabase/admin.ts";
import { getDataProvider } from "./data/provider.ts";
import { buildEvent } from "./sync/eventBuilder.ts";
import { pickOnePerEpisode } from "./programs.ts";
import { buildIcs, type IcsEvent } from "./ics.ts";
import { DEFAULT_REGION, isStreamingChannel, type Region } from "./regions.ts";
import { getUserRegion } from "./userRegion.ts";
import type { Program, WorkDetail } from "./types.ts";

/**
 * ICSフィード（ユーザーごとの購読カレンダー）の組み立て。
 * 窓: 未来120日 + 過去45日（放送済みの回がクール途中で消えないように）。
 */
const FUTURE_DAYS = 120;
const PAST_DAYS = 45;
const CALENDAR_NAME = "アニメ放送カレンダー";

function newToken(): string {
  return crypto.randomBytes(24).toString("base64url");
}

/** 初回アクセス時にトークンを発行（既にあればそれを返す） */
export async function ensureIcsToken(userId: string): Promise<string> {
  const db = getAdminClient();
  const { data } = await db.from("app_users").select("ics_token").eq("id", userId).maybeSingle();
  if (data?.ics_token) return data.ics_token;

  const token = newToken();
  // 同時アクセスで二重生成しないよう、まだ null の場合のみ書き込む
  await db.from("app_users").update({ ics_token: token }).eq("id", userId).is("ics_token", null);
  const { data: after } = await db.from("app_users").select("ics_token").eq("id", userId).maybeSingle();
  return after?.ics_token ?? token;
}

/** トークンを作り直す（旧URLは即座に無効になる） */
export async function regenerateIcsToken(userId: string): Promise<string> {
  const db = getAdminClient();
  const token = newToken();
  const { error } = await db.from("app_users").update({ ics_token: token }).eq("id", userId);
  if (error) throw error;
  return token;
}

export async function getUserIdByToken(token: string): Promise<string | null> {
  if (!token) return null;
  const db = getAdminClient();
  const { data } = await db.from("app_users").select("id").eq("ics_token", token).maybeSingle();
  return data?.id ?? null;
}

interface FeedOptions {
  mode: "per_episode" | "whole";
  includeSubtitle: boolean;
  includeChannel: boolean;
  includeUrl: boolean;
}

function appUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
}

/** 1作品ぶんの放送回を窓でフィルタし、ICSイベントへ変換する */
function workToEvents(work: WorkDetail, opts: FeedOptions, region: Region = DEFAULT_REGION): IcsEvent[] {
  const now = Date.now();
  const from = now - PAST_DAYS * 86400000;
  const to = now + FUTURE_DAYS * 86400000;
  const inWindow = work.programs.filter((p: Program) => {
    const t = new Date(p.startAt).getTime();
    // テレビ放送のみ: ネット配信・AT-X はカレンダーに出さない（放送が無い回はイベントを作らない）
    return t >= from && t <= to && !p.isRebroadcast && !isStreamingChannel(p.channelName);
  });
  // 系列局の同時ネットは1話1件（住んでいる地域の代表局）に集約
  return pickOnePerEpisode(inWindow, region).map((program) => {
    const episode = work.episodes.find((e) => e.id === program.episodeId) ?? null;
    const ev = buildEvent(work, program, episode, opts, appUrl());
    return {
      // 安定UID: 同じ放送回は毎回同じUID → Google側で更新・削除が正しく反映される
      uid: `anidb-prog-${program.id}@anime-calendar`,
      startISO: ev.startISO,
      endISO: ev.endISO,
      summary: ev.summary,
      description: ev.description,
    };
  });
}

/** ユーザーの有効な購読すべてを1本のICSフィードにまとめる */
export async function buildUserFeed(userId: string): Promise<string> {
  const db = getAdminClient();
  const provider = await getDataProvider();
  const region = await getUserRegion(userId);
  const { data: subs } = await db
    .from("subscriptions")
    .select("work_id, mode, include_subtitle, include_channel, include_url")
    .eq("user_id", userId)
    .eq("status", "active");

  const events: IcsEvent[] = [];
  for (const row of subs ?? []) {
    const work = await provider.getWork(row.work_id);
    if (!work) continue;
    events.push(
      ...workToEvents(
        work,
        {
          mode: row.mode,
          includeSubtitle: row.include_subtitle,
          includeChannel: row.include_channel,
          includeUrl: row.include_url,
        },
        region,
      ),
    );
  }
  events.sort((a, b) => a.startISO.localeCompare(b.startISO));
  return buildIcs(events, { name: CALENDAR_NAME });
}

/** seedモード用のサンプルフィード（トークン "demo"） */
export async function buildDemoFeed(): Promise<string> {
  const provider = await getDataProvider();
  const list = await provider.listWorks({ tab: "this_season", perPage: 5 });
  const opts: FeedOptions = { mode: "per_episode", includeSubtitle: true, includeChannel: true, includeUrl: true };
  const events: IcsEvent[] = [];
  for (const summary of list.items) {
    const work = await provider.getWork(summary.id);
    if (work) events.push(...workToEvents(work, opts));
  }
  events.sort((a, b) => a.startISO.localeCompare(b.startISO));
  return buildIcs(events, { name: `${CALENDAR_NAME}（デモ）` });
}
