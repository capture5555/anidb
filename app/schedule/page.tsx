import Link from "next/link";
import { getDataProvider } from "@/lib/data/provider";
import { WorkCover } from "@/components/WorkCover";
import { AddToCalendar } from "@/components/AddToCalendar";
import { airSlot, WEEKDAY_LABELS, formatPopularity } from "@/lib/format";
import type { ScheduleEntry } from "@/lib/types";

export const metadata = { title: "番組表" };

const WEEKDAY_EN = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
// 月曜始まりで並べる
const ORDER = [1, 2, 3, 4, 5, 6, 0];

export default async function SchedulePage() {
  const provider = await getDataProvider();
  const entries = await provider.getSchedule();

  const byDay = new Map<number, (ScheduleEntry & { slotLabel: string; sortKey: number })[]>();
  for (const e of entries) {
    const s = airSlot(e.startAt);
    const item = { ...e, slotLabel: s.label, sortKey: s.hour * 60 + s.minute };
    if (!byDay.has(e.weekday)) byDay.set(e.weekday, []);
    byDay.get(e.weekday)!.push(item);
  }
  for (const list of byDay.values()) list.sort((a, b) => a.sortKey - b.sortKey || b.popularity - a.popularity);

  return (
    <div className="mx-auto max-w-6xl px-5 sm:px-8">
      <section className="pt-12 pb-6 border-b border-line">
        <p className="kicker">Weekly schedule</p>
        <h1 className="display text-3xl sm:text-[2.4rem] leading-tight mt-3">番組表</h1>
        <p className="text-ink-soft mt-3 max-w-xl text-[0.95rem]">
          放送中のTVアニメを曜日・時間順に。各作品の「追加」からそのままGoogleカレンダーへ登録できます。
          （深夜帯は慣習に合わせて前日の25:00〜表記）
        </p>
      </section>

      {entries.length === 0 ? (
        <div className="py-20 text-center">
          <p className="display text-xl">表示できる放送予定がありません</p>
          <p className="text-sm text-muted mt-2">データの取り込み後に表示されます。</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-x-8 gap-y-10 py-10">
          {ORDER.filter((wd) => byDay.has(wd)).map((wd) => (
            <section key={wd}>
              <div className="flex items-baseline gap-2 mb-3 pb-2 border-b border-line-strong">
                <h2 className="display text-xl text-ink">{WEEKDAY_LABELS[wd]}曜</h2>
                <span className="kicker">{WEEKDAY_EN[wd]}</span>
                <span className="text-xs text-muted ml-auto">{byDay.get(wd)!.length}本</span>
              </div>
              <ul className="space-y-3">
                {byDay.get(wd)!.map((e) => (
                  <li key={e.workId} className="flex gap-3 items-center">
                    <Link href={`/works/${e.workId}`} className="shrink-0">
                      <WorkCover
                        id={e.workId}
                        title={e.title}
                        url={e.posterUrl}
                        className="w-10 h-14 rounded-[var(--radius-card)] border border-line"
                      />
                    </Link>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline gap-2">
                        <span className="display text-sm text-accent tabular-nums shrink-0">{e.slotLabel}</span>
                        <Link
                          href={`/works/${e.workId}`}
                          className="text-[0.9rem] text-ink hover:text-accent transition truncate"
                        >
                          {e.title}
                        </Link>
                      </div>
                      <p className="text-xs text-muted truncate">
                        {e.channelName ?? "放送局未定"}
                        {e.count != null && ` ・ 第${e.count}話`}
                        {e.popularity > 0 && ` ・ ♡${formatPopularity(e.popularity)}`}
                      </p>
                    </div>
                    <div className="shrink-0">
                      <AddToCalendar workId={e.workId} workTitle={e.title} compact />
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
