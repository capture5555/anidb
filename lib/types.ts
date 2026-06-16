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
  popularity: number; // 人気度（Annictウォッチャー数）
  /** 映画の公開日（YYYY-MM-DD）。一覧カードの上映ステータス・公開日表示に使う。 */
  releasedOn?: string | null;
  /** 公開日の曖昧表記（「2026年春」等）。 */
  releasedOnAbout?: string | null;
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
  // 評価（海外/MAL）。未取得は null。
  anilistScore: number | null; // 0-100
  anilistPopularity: number | null;
  malScore: number | null; // 0-10
  malScoredBy: number | null;
  malMembers: number | null;
}

// --- ユーザー/連携系 ---

export type SubscriptionMode = "per_episode" | "whole";

export interface Subscription {
  id: string;
  userId: string;
  workId: string;
  mode: SubscriptionMode;
  includeSubtitle: boolean;
  includeChannel: boolean;
  includeUrl: boolean;
  autoSync: boolean;
  status: "active" | "paused" | "cancelled";
  createdAt: string;
  /** この購読に固有の放送局選択（カレンダーがグローバル選択より優先する）。
   *  DB列 subscriptions.channels (migration 0010) は後から追加されるため、未マイグレーション時は undefined/null。 */
  channels?: string[] | null;
}

// --- 一覧クエリ ---

export type ListTab = "this_season" | "next_season" | "movie_now" | "movie_upcoming";

/** 映画タブの並び替え種別。 */
export type MovieSort = "popular" | "newest" | "upcoming" | "kana";

export interface WorkQuery {
  tab?: ListTab;
  season?: string; // "2026-spring"
  status?: WorkStatus;
  genre?: string;
  q?: string;
  page?: number;
  perPage?: number;
  /** 並び替え（主に映画タブで使用。未指定は人気順）。 */
  sort?: MovieSort;
}

export interface WorkListResult {
  items: WorkSummary[];
  page: number;
  perPage: number;
  total: number;
  hasNext: boolean;
}

/** ミニ番組表の1エントリ（作品の次回放送） */
export interface ScheduleEntry {
  workId: string;
  title: string;
  posterUrl: string | null;
  weekday: number; // 0=日 .. 6=土（JST）
  startAt: string; // ISO（次回放送）
  channelName: string | null;
  count: number | null; // 話数
  popularity: number;
}
