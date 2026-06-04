import Link from "next/link";
import type { WorkSummary } from "@/lib/types";
import { WorkCover } from "./WorkCover";
import { StatusBadge } from "./StatusBadge";
import { formatSeason } from "@/lib/season";

export function WorkCard({ work }: { work: WorkSummary }) {
  return (
    <Link href={`/works/${work.id}`} className="group block">
      <article className="flex flex-col h-full">
        <WorkCover
          id={work.id}
          title={work.title}
          url={work.keyVisualUrl}
          className="aspect-[3/4] w-full rounded-[var(--radius-card)] border border-line transition-shadow group-hover:border-line-strong"
        />
        <div className="pt-3 flex flex-col gap-1.5">
          <div className="flex items-center gap-2">
            <StatusBadge status={work.status} />
            <span className="text-xs text-muted">
              {formatSeason(work.seasonYear, work.seasonName)}
            </span>
          </div>
          <h3 className="display text-[1.02rem] leading-snug text-ink group-hover:text-accent transition-colors">
            {work.title}
          </h3>
          {work.genres.length > 0 && (
            <p className="text-xs text-muted leading-relaxed">
              {work.genres.slice(0, 3).join("・")}
            </p>
          )}
        </div>
      </article>
    </Link>
  );
}
