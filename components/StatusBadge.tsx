import type { WorkStatus } from "@/lib/types";

const MAP: Record<WorkStatus, { label: string; className: string }> = {
  airing: {
    label: "放送中",
    className: "text-[var(--color-good)] border-[var(--color-good)]/35 bg-[var(--color-good)]/8",
  },
  upcoming: {
    label: "放送予定",
    className: "text-[var(--color-info)] border-[var(--color-info)]/35 bg-[var(--color-info)]/8",
  },
  finished: {
    label: "放送終了",
    className: "text-muted border-line-strong bg-paper-deep",
  },
};

export function StatusBadge({ status }: { status: WorkStatus }) {
  const m = MAP[status];
  return (
    <span
      className={`inline-flex items-center gap-1.5 border px-2 py-0.5 text-[0.7rem] font-medium tracking-wide rounded-[var(--radius-card)] ${m.className}`}
    >
      <span className="inline-block w-1.5 h-1.5 rounded-full bg-current opacity-70" />
      {m.label}
    </span>
  );
}
