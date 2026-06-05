import Link from "next/link";
import { getDataProvider } from "@/lib/data/provider";
import { WorkCover } from "./WorkCover";
import { AddToCalendar } from "./AddToCalendar";
import { formatAirShort } from "@/lib/format";

/** TOPページの「この後の放送」ミニ番組表（直近に放送される作品を早い順に） */
export async function UpcomingStrip() {
  const provider = await getDataProvider();
  const items = await provider.getUpcomingBroadcasts(10).catch(() => []);
  if (items.length === 0) return null;

  return (
    <section className="mt-7 border border-line rounded-[var(--radius-card)] bg-paper-deep/40 p-4">
      <div>
        <div className="flex items-baseline gap-2 mb-3">
          <span className="inline-block w-1.5 h-1.5 rounded-full bg-accent" />
          <h2 className="display text-base text-ink">この後の放送</h2>
          <Link href="/schedule" className="kicker ml-auto hover:text-accent">
            番組表へ →
          </Link>
        </div>
        <ul className="flex gap-3 overflow-x-auto pb-1 -mx-1 px-1">
          {items.map((e) => (
            <li
              key={e.workId}
              className="shrink-0 w-56 flex gap-2.5 items-center border border-line rounded-[var(--radius-card)] bg-surface p-2"
            >
              <Link href={`/works/${e.workId}`} className="shrink-0">
                <WorkCover
                  id={e.workId}
                  title={e.title}
                  url={e.posterUrl}
                  className="w-9 h-12 rounded-[1px] border border-line"
                />
              </Link>
              <div className="min-w-0 flex-1">
                <p className="text-[0.7rem] text-accent tabular-nums">{formatAirShort(e.startAt)}</p>
                <Link
                  href={`/works/${e.workId}`}
                  className="block text-xs text-ink hover:text-accent transition truncate leading-snug"
                >
                  {e.title}
                </Link>
                <p className="text-[0.65rem] text-muted truncate">{e.channelName ?? ""}</p>
              </div>
              <div className="shrink-0">
                <AddToCalendar workId={e.workId} workTitle={e.title} compact />
              </div>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
