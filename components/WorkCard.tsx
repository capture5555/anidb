import Link from "next/link";
import type { WorkSummary } from "@/lib/types";
import { WorkCover } from "./WorkCover";
import { StatusBadge } from "./StatusBadge";
import { formatPopularity } from "@/lib/format";
import { genreJa } from "@/lib/genres";
import { formatReleaseDate } from "@/lib/movie";

export function WorkCard({ work }: { work: WorkSummary }) {
  const releaseLabel = work.media === "movie" ? formatReleaseDate(work) : null;
  return (
    <Link href={`/works/${work.id}`} className="group block h-full">
      <article className="card card-hover overflow-hidden flex flex-col h-full">
        <div className="relative">
          <WorkCover
            id={work.id}
            title={work.title}
            url={work.keyVisualUrl}
            className="aspect-[3/4] w-full"
          />
          <div className="absolute top-2 left-2">
            <StatusBadge status={work.status} work={work} />
          </div>
          {releaseLabel && (
            <span className="absolute bottom-2 left-2 inline-flex items-center rounded bg-black/65 text-white text-[0.68rem] font-bold px-1.5 py-0.5">
              {releaseLabel}〜
            </span>
          )}
          {work.popularity > 0 && (
            <span
              className="absolute bottom-2 right-2 inline-flex items-center gap-1 rounded bg-black/65 text-white text-[0.68rem] font-bold px-1.5 py-0.5 tabular-nums"
              title={`ウォッチャー ${work.popularity.toLocaleString()}人`}
            >
              <svg width="9" height="9" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
                <path d="M8 14S1.5 9.7 1.5 5.5C1.5 3.5 3 2 4.8 2 6 2 7.2 2.7 8 3.8 8.8 2.7 10 2 11.2 2 13 2 14.5 3.5 14.5 5.5 14.5 9.7 8 14 8 14Z" />
              </svg>
              {formatPopularity(work.popularity)}
            </span>
          )}
        </div>
        <div className="p-3 flex flex-col gap-1 flex-1">
          <h3 className="font-bold text-[0.92rem] leading-snug text-ink group-hover:text-primary transition-colors line-clamp-2">
            {work.title}
          </h3>
          {work.genres.length > 0 && (
            <p className="text-[0.72rem] text-muted truncate mt-auto pt-1">
              {work.genres.slice(0, 3).map(genreJa).join("・")}
            </p>
          )}
        </div>
      </article>
    </Link>
  );
}
