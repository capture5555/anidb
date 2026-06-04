// ============================================================
//  ドメイン型定義（DB設計 docs/04 に対応）
// ============================================================

export type Season = "winter" | "spring" | "summer" | "autumn";
export type WorkStatus = "upcoming" | "airing" | "finished";
export type Media = "tv" | "movie" | "ova" | "web" | "other";

export interface Genre {
  id: string;
  name: string;
}

export interface Episode {
  id: string;
  workId: string;
  number: number | null;
  numberText: string | null;
  title: string | null; // サブタイトル（マージ後）
  titleSource: "annict" | "syoboi" | "manual" | null;
  sort: number;
}

export interface CastEntry {
  id: string;
  characterName: string;
  personName: string;
  personId: string | null;
  sort: number;
}

export interface StaffEntry {
  id: string;
  role: string;
  personName: string;
  personId: string | null;
  sort: number;
}

export interface Channel {
  id: string;
  name: string;
  syoboiChid: number | null;
}

export interface Program {
  id: string;
  workId: string;
  episodeId: string | null;
  channelId: string | null;
  channelName: string | null;
  count: number | null;
  startAt: string; // ISO8601
  endAt: string | null;
  isRebroadcast: boolean;
  syoboiPid: number | null;
}

/** 一覧カード用の軽量型 */
export interface WorkSummary {
  id: string;
  title: string;
  titleKana: string | null;
  keyVisualUrl: string | null;
  seasonYear: number | null;
  seasonName: Season | null;
  status: WorkStatus;
  media: Media | null;
  genres: string[];
}

/** 詳細ページ用の完全型 */
export interface WorkDetail extends WorkSummary {
  titleEn: string | null;
  synopsis: string | null;
  officialSiteUrl: string | null;
  episodes: Episode[];
  casts: CastEntry[];
  staff: StaffEntry[];
  programs: Program[];
}

// --- ユーザー/連携系 ---

export type SubscriptionMode = "per_episode" | "whole";

export interface Subscription {
  id: string;
  userId: string;
  workId: string;
  googleCalendarId: string;
  mode: SubscriptionMode;
  includeSubtitle: boolean;
  includeChannel: boolean;
  includeUrl: boolean;
  autoSync: boolean;
  status: "active" | "paused" | "cancelled";
  createdAt: string;
}

export interface GoogleCalendarInfo {
  id: string;
  summary: string;
  primary: boolean;
  accessRole: "owner" | "writer" | "reader" | "freeBusyReader";
  backgroundColor?: string;
}

// --- 一覧クエリ ---

export type ListTab = "this_season" | "next_season" | "airing" | "upcoming";

export interface WorkQuery {
  tab?: ListTab;
  season?: string; // "2026-spring"
  status?: WorkStatus;
  genre?: string;
  q?: string;
  page?: number;
  perPage?: number;
}

export interface WorkListResult {
  items: WorkSummary[];
  page: number;
  perPage: number;
  total: number;
  hasNext: boolean;
}
