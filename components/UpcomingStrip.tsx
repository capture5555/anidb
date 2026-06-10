import Link from "next/link";
import { getDataProvider } from "@/lib/data/provider";
import { WorkCover } from "./WorkCover";
import { SubscribeButton } from "./SubscribeButton";
import { formatAirShort } from "@/lib/format";

/** TOPページの「この後の放送」ミニ番組表（直近に放送される作品を早い順に） */
export async function UpcomingStrip() {
  const provider = await getDataProvider();
  const items = await provider.getUpcomingBroadcasts(10).catch(() => []);
  if (items.length === 0) return null;

  return (
    <section className="mt-6">
      <div className="flex items-center gap-2 mb-2.5">
        <h2 className="section-title text-base">この後の放送</h2>
        <Link
          href="/schedule"
          className="ml-auto text-xs font-bold text-primary hover:underline underline-offset-2"
        >
          番組表を見る →
        </Link>
      </div>
      <ul className="flex gap-2.5 overflow-x-auto pb-2 -mx-1 px-1">
        {items.map((e) => (
          <li
            key={e.workId}
            className="card shrink-0 w-60 flex gap-2.5 items-center p-2.5"
          >
            <Link href={`/works/${e.workId}`} className="shrink-0">
              <WorkCover
                id={e.workId}
                title={e.title}
                url={e.posterUrl}
                className="w-10 h-13 rounded-md"
              />
            </Link>
            <div className="min-w-0 flex-1">
              <p className="text-[0.7rem] font-bold text-accent tabular-nums">
                {formatAirShort(e.startAt)}
              </p>
              <Link
                href={`/works/${e.workId}`}
                className="block text-xs font-bold text-ink hover:text-primary transition truncate leading-snug"
              >
                {e.title}
              </Link>
              <p className="text-[0.65rem] text-muted truncate">{e.channelName ?? ""}</p>
            </div>
            <div className="shrink-0">
              <SubscribeButton workId={e.workId} workTitle={e.title} compact />
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
