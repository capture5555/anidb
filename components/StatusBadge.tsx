import type { WorkStatus } from "@/lib/types";

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

export function StatusBadge({ status }: { status: WorkStatus }) {
  const m = MAP[status];
  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-[3px] text-[0.68rem] font-bold rounded ${m.className}`}
    >
      {m.dot && <span className="inline-block w-1.5 h-1.5 rounded-full bg-white animate-pulse" />}
      {m.label}
    </span>
  );
}
