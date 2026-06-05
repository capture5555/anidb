import Link from "next/link";
import type { WorkSummary } from "@/lib/types";
import { WorkCover } from "./WorkCover";
import { StatusBadge } from "./StatusBadge";
import { formatSeason } from "@/lib/season";
import { formatPopularity } from "@/lib/format";

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
          <div className="flex items-center justify-between gap-2">
            {work.genres.length > 0 ? (
              <p className="text-xs text-muted leading-relaxed truncate">
                {work.genres.slice(0, 2).join("・")}
              </p>
            ) : (
              <span />
            )}
            {work.popularity > 0 && (
              <span className="shrink-0 inline-flex items-center gap-1 text-xs text-muted tabular-nums" title={`ウォッチャー ${work.popularity.toLocaleString()}人`}>
                <HeartGlyph />
                {formatPopularity(work.popularity)}
              </span>
            )}
          </div>
        </div>
      </article>
    </Link>
  );
}

function HeartGlyph() {
  return (
    <svg width="11" height="11" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path
        d="M8 13.5C8 13.5 1.5 9.5 1.5 5.5C1.5 3.6 3 2.2 4.8 2.2C6 2.2 7.2 2.9 8 4C8.8 2.9 10 2.2 11.2 2.2C13 2.2 14.5 3.6 14.5 5.5C14.5 9.5 8 13.5 8 13.5Z"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
    </svg>
  );
}
