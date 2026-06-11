import crypto from "node:crypto";
import { getAdminClient } from "./supabase/admin.ts";
import { getDataProvider } from "./data/provider.ts";
import { buildEvent } from "./sync/eventBuilder.ts";
import { pickOnePerEpisode } from "./programs.ts";
import { buildIcs, type IcsEvent } from "./ics.ts";
import { isStreamingChannel } from "./regions.ts";
import { channelMatches, seedChannelsFromRegion } from "./channels.ts";
import { getUserRegion } from "./userRegion.ts";
import { getUserChannels } from "./userChannels.ts";
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
function workToEvents(
  work: WorkDetail,
  opts: FeedOptions,
  channels: string[] = [],
  subChannels?: string[] | null,
): IcsEvent[] {
  const now = Date.now();
  const from = now - PAST_DAYS * 86400000;
  const to = now + FUTURE_DAYS * 86400000;
  // この購読固有の放送局選択（subChannels）が空でなければそれを優先。無ければグローバル選択。
  const effective = subChannels && subChannels.length > 0 ? subChannels : channels;
  // 窓内・本放送・配信(AT-X含む)以外の放送波。
  const base = work.programs.filter((p: Program) => {
    const t = new Date(p.startAt).getTime();
    return t >= from && t <= to && !p.isRebroadcast && !isStreamingChannel(p.channelName);
  });
  // 選択した放送局で視聴できる放送があるなら、それだけに絞る。
  // ＝選択外の局(他地域ローカル等)やBSの重複を出さない。選択局で見られる放送が1つも無い作品だけ、
  //   カレンダーから消さないよう全放送を残す（BSのみ等の作品の保険）。
  const regional = base.filter((p) => channelMatches(p.channelName, effective));
  const inWindow = regional.length > 0 ? regional : base;
  // 同じ回の系列ネットは1話1件（選択局の代表）に集約
  return pickOnePerEpisode(inWindow, effective).map((program) => {
    // episode_id で紐付け。未リンク（話数レコード未作成等）の場合は話数(count)で代替マッチし、
    // サブタイトルが取れるようにする（位置ベース紐付けの取りこぼし対策）。
    const episode =
      work.episodes.find((e) => e.id === program.episodeId) ??
      (program.count != null ? work.episodes.find((e) => e.number === program.count) ?? null : null);
    const ev = buildEvent(work, program, episode, opts, appUrl());
    return {
      // 安定UID: 同じ放送回は毎回同じUID → Google側で更新・削除が正しく反映される
      uid: `anidb-prog-${program.id}@anime-calendar`,
      startISO: ev.startISO,
      endISO: ev.endISO,
      summary: ev.summary,
      description: ev.description,
      location: ev.location,
    };
  });
}

/** ユーザーの有効な購読すべてを1本のICSフィードにまとめる */
export async function buildUserFeed(userId: string): Promise<string> {
  const db = getAdminClient();
  const provider = await getDataProvider();
  // グローバル放送局選択を優先。未設定（空）なら（レガシー）地域の種からの既定セットへフォールバック。
  const userChannels = await getUserChannels(userId);
  const channels =
    userChannels.length > 0 ? userChannels : seedChannelsFromRegion(await getUserRegion(userId));
  // channels 列を含めて取得。列が無い（migration 0010 未適用）場合は列なしの select へフォールバック。
  const withChannels = await db
    .from("subscriptions")
    .select("work_id, mode, include_subtitle, include_channel, include_url, channels")
    .eq("user_id", userId)
    .eq("status", "active");
  let subs: Record<string, unknown>[] | null = withChannels.data;
  if (withChannels.error) {
    const withoutChannels = await db
      .from("subscriptions")
      .select("work_id, mode, include_subtitle, include_channel, include_url")
      .eq("user_id", userId)
      .eq("status", "active");
    subs = withoutChannels.data;
  }

  const events: IcsEvent[] = [];
  for (const raw of subs ?? []) {
    const row = raw as {
      work_id: string;
      mode: FeedOptions["mode"];
      include_subtitle: boolean;
      include_channel: boolean;
      include_url: boolean;
      channels?: string[] | null;
    };
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
        channels,
        // pre-migration 等で channels 列が無い行では undefined。
        row.channels,
      ),
    );
  }
  events.sort((a, b) => a.startISO.localeCompare(b.startISO));
  // 毎時更新なので購読クライアントにも1時間間隔の再取得を提示（尊重するクライアント向け）
  return buildIcs(events, { name: CALENDAR_NAME, refreshIntervalHours: 1 });
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
