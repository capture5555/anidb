import type { Program, Episode, WorkDetail, Subscription } from "../types.ts";

const DEFAULT_DURATION_MIN = 30;

/** 1つの放送回ぶんのイベント内容（ICSフィードの VEVENT の元になる） */
export interface BuiltEvent {
  summary: string;
  description: string;
  startISO: string;
  endISO: string;
}

/**
 * 1つの放送回(program)に対するカレンダーイベント内容を組み立てる。
 * - タイトル形式（作品単位/各話）は subscription.mode に従う。
 * - サブタイトルは episode.title（マージ後の値, docs/04）が有ればのみ反映。無ければ省略=登録は止めない。
 */
export function buildEvent(
  work: WorkDetail,
  program: Program,
  episode: Episode | null,
  sub: Pick<Subscription, "mode" | "includeSubtitle" | "includeChannel" | "includeUrl">,
  appUrl: string,
): BuiltEvent {
  const subtitle = episode?.title ?? null;
  const countLabel = program.count != null ? `第${program.count}話` : episode?.numberText ?? null;

  // タイトル
  let summary: string;
  if (sub.mode === "per_episode" && countLabel) {
    summary = `【アニメ】${work.title} ${countLabel}`;
    if (sub.includeSubtitle && subtitle) summary += `「${subtitle}」`;
  } else {
    summary = `【アニメ】${work.title}`;
  }

  // 説明欄（取得できた範囲で）
  const lines: string[] = [];
  if (sub.includeSubtitle && subtitle) lines.push(`サブタイトル: ${subtitle}`);
  if (sub.includeChannel && program.channelName) lines.push(`放送局: ${program.channelName}`);
  if (sub.includeUrl) lines.push(`作品ページ: ${appUrl}/works/${work.id}`);
  lines.push("（この予定は アニメ放送カレンダー の購読フィードから配信されています）");
  const description = lines.join("\n");

  // 時刻
  const startISO = program.startAt;
  const endISO =
    program.endAt ??
    new Date(new Date(program.startAt).getTime() + DEFAULT_DURATION_MIN * 60 * 1000).toISOString();

  return { summary, description, startISO, endISO };
}
