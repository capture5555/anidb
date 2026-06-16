import type { WorkStatus, WorkSummary } from "@/lib/types";
import { movieScreeningStatus, type ScreeningKind } from "@/lib/movie";

const MAP: Record<WorkStatus, { label: string; className: string; dot: boolean }> = {
  airing: {
    label: "放送中",
    className: "bg-[var(--color-good)] text-white",
    dot: true,
  },
  upcoming: {
    label: "放送予定",
    className: "bg-[var(--color-info)] text-white",
    dot: false,
  },
  finished: {
    label: "放送終了",
    className: "bg-paper-deep text-muted",
    dot: false,
  },
};

// 映画（劇場）の上映ステータス表示。放送ではなく上映で見分ける。
const MOVIE_MAP: Record<ScreeningKind, { className: string; dot: boolean }> = {
  now: { className: "bg-[var(--color-good)] text-white", dot: true }, // 上映中
  soon: { className: "bg-[var(--color-accent)] text-white", dot: true }, // 近日上映開始
  scheduled: { className: "bg-[var(--color-info)] text-white", dot: false }, // 上映予定
  ended: { className: "bg-paper-deep text-muted", dot: false }, // 上映終了
};

/** 映画は releasedOn/season を渡すと上映ステータス、それ以外は放送ステータスを表示する。 */
export function StatusBadge({
  status,
  work,
}: {
  status: WorkStatus;
  work?: Pick<WorkSummary, "media" | "releasedOn" | "releasedOnAbout" | "seasonYear" | "seasonName">;
}) {
  let label: string;
  let className: string;
  let dot: boolean;

  if (work?.media === "movie") {
    const s = movieScreeningStatus(work);
    const m = MOVIE_MAP[s.kind];
    label = s.label;
    className = m.className;
    dot = m.dot;
  } else {
    const m = MAP[status];
    label = m.label;
    className = m.className;
    dot = m.dot;
  }

  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-[3px] text-[0.68rem] font-bold rounded ${className}`}
    >
      {dot && <span className="inline-block w-1.5 h-1.5 rounded-full bg-white animate-pulse" />}
      {label}
    </span>
  );
}
