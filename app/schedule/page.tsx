export const dynamic = "force-dynamic";
import Link from "next/link";
import { getDataProvider } from "@/lib/data/provider";
import { WorkCover } from "@/components/WorkCover";
import { SubscribeButton } from "@/components/SubscribeButton";
import { airSlot, WEEKDAY_LABELS, formatPopularity } from "@/lib/format";
import type { ScheduleEntry } from "@/lib/types";

export const metadata = { title: "番組表" };

// 月曜始まりで並べる
const ORDER = [1, 2, 3, 4, 5, 6, 0];
const DAY_COLOR: Record<number, string> = {
  0: "#e8482f", // 日
  1: "#454c59",
  2: "#454c59",
  3: "#454c59",
  4: "#454c59",
  5: "#454c59",
  6: "#2f6fdb", // 土
};

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
    <div className="mx-auto max-w-6xl px-4 sm:px-6">
      <div className="pt-8 mb-5">
        <h1 className="text-xl sm:text-2xl font-black text-ink">週間番組表</h1>
        <p className="text-sm text-ink-soft mt-1.5">
          放送中のTVアニメを曜日・時間順に。「登録」からカレンダー購読リストへ追加できます。
          深夜帯は前日の25:00〜表記です。
        </p>
      </div>

      {entries.length === 0 ? (
        <div className="card py-20 text-center">
          <p className="text-lg font-bold">表示できる放送予定がありません</p>
          <p className="text-sm text-muted mt-2">データの取り込み後に表示されます。</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 pb-10">
          {ORDER.filter((wd) => byDay.has(wd)).map((wd) => (
            <section key={wd} className="card overflow-hidden self-start">
              <div className="flex items-baseline gap-2 px-4 py-2.5 bg-paper border-b border-line">
                <h2 className="text-base font-black" style={{ color: DAY_COLOR[wd] }}>
                  {WEEKDAY_LABELS[wd]}曜日
                </h2>
                <span className="text-xs text-muted ml-auto tabular-nums">{byDay.get(wd)!.length}本</span>
              </div>
              <ul className="divide-y divide-line">
                {byDay.get(wd)!.map((e) => (
                  <li key={e.workId} className="flex gap-3 items-center px-3.5 py-2.5">
                    <span className="font-black text-[0.82rem] text-ink tabular-nums shrink-0 w-12">
                      {e.slotLabel}
                    </span>
                    <Link href={`/works/${e.workId}`} className="shrink-0">
                      <WorkCover
                        id={e.workId}
                        title={e.title}
                        url={e.posterUrl}
                        className="w-9 h-12 rounded-md"
                      />
                    </Link>
                    <div className="min-w-0 flex-1">
                      <Link
                        href={`/works/${e.workId}`}
                        className="block text-[0.85rem] font-bold text-ink hover:text-primary transition truncate leading-snug"
                      >
                        {e.title}
                      </Link>
                      <p className="text-[0.7rem] text-muted truncate">
                        {e.channelName ?? "放送局未定"}
                        {e.count != null && ` ・ 第${e.count}話`}
                        {e.popularity > 0 && ` ・ ♥${formatPopularity(e.popularity)}`}
                      </p>
                    </div>
                    <div className="shrink-0">
                      <SubscribeButton workId={e.workId} workTitle={e.title} compact />
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
