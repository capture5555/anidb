export const dynamic = "force-dynamic";
import Link from "next/link";
import { cookies } from "next/headers";
import { getDataProvider } from "@/lib/data/provider";
import { WorkCover } from "@/components/WorkCover";
import { SubscribeButton } from "@/components/SubscribeButton";
import { ChannelSelector } from "@/components/ChannelSelector";
import { airSlot, WEEKDAY_LABELS, formatPopularity } from "@/lib/format";
import { parseRegion, REGION_COOKIE } from "@/lib/regions";
import {
  parseChannelsCookie,
  seedChannelsFromRegion,
  CHANNELS_COOKIE,
} from "@/lib/channels";
import { getSession } from "@/lib/session";
import { isGoogleConfigured } from "@/lib/google/oauth";
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

// チャンネル別表示の並び順（地上波→BS→CS）。前方一致で判定し、未知局は末尾に五十音順。
const CHANNEL_ORDER = [
  "NHK総合",
  "NHK Eテレ",
  "NHK",
  "日本テレビ",
  "テレビ朝日",
  "TBS",
  "テレビ東京",
  "フジテレビ",
  "TOKYO MX",
  "BS11",
  "BS日テレ",
  "BSフジ",
  "BS朝日",
  "BS-TBS",
  "BSテレ東",
  "AT-X",
];
function channelRank(name: string): number {
  const i = CHANNEL_ORDER.findIndex((p) => name.includes(p));
  return i < 0 ? CHANNEL_ORDER.length : i;
}

export default async function SchedulePage({
  searchParams,
}: {
  searchParams: Promise<{ scope?: string }>;
}) {
  const sp = await searchParams;
  const scope: "current" | "next" = sp.scope === "next" ? "next" : "current";

  // 放送局選択を Cookie から取得。未設定なら（レガシー）地域の種から既定セットを使う。
  const cookieStore = await cookies();
  const cookieChannels = parseChannelsCookie(cookieStore.get(CHANNELS_COOKIE)?.value);
  const channels =
    cookieChannels.length > 0
      ? cookieChannels
      : seedChannelsFromRegion(parseRegion(cookieStore.get(REGION_COOKIE)?.value));
  const loggedIn = isGoogleConfigured() && (await getSession()) != null;

  const provider = await getDataProvider();
  const entries = await provider.getSchedule(channels, scope);

  // チャンネル別にグルーピング。各局内は 曜日(月曜始まり) → 時刻 の順。
  type Row = ScheduleEntry & { slotLabel: string; weekdayRank: number; timeKey: number };
  const byChannel = new Map<string, Row[]>();
  for (const e of entries) {
    const s = airSlot(e.startAt);
    const ch = e.channelName ?? "放送局未定";
    const row: Row = {
      ...e,
      slotLabel: s.label,
      weekdayRank: ORDER.indexOf(e.weekday),
      timeKey: s.hour * 60 + s.minute,
    };
    if (!byChannel.has(ch)) byChannel.set(ch, []);
    byChannel.get(ch)!.push(row);
  }
  for (const list of byChannel.values()) {
    list.sort(
      (a, b) => a.weekdayRank - b.weekdayRank || a.timeKey - b.timeKey || b.popularity - a.popularity,
    );
  }
  const orderedChannels = [...byChannel.keys()].sort(
    (a, b) => channelRank(a) - channelRank(b) || a.localeCompare(b, "ja"),
  );

  return (
    <div className="mx-auto max-w-6xl px-4 sm:px-6">
      <div className="pt-8 mb-5">
        <div className="flex items-center gap-3 flex-wrap">
          <h1 className="text-xl sm:text-2xl font-black text-ink">週間番組表</h1>
          <div className="ml-auto">
            <ChannelSelector initial={channels} loggedIn={loggedIn} />
          </div>
        </div>
        <nav className="border-b-2 border-line mt-3">
          <ul className="flex gap-1 -mb-[2px]">
            {[
              { key: "current", label: "今期" },
              { key: "next", label: "来季" },
            ].map((t) => {
              const isActive = t.key === scope;
              return (
                <li key={t.key}>
                  <Link
                    href={t.key === "current" ? "/schedule" : "/schedule?scope=next"}
                    className={`inline-block px-5 sm:px-7 py-2.5 font-bold text-[0.95rem] border-b-[3px] transition-colors ${
                      isActive
                        ? "border-accent text-ink"
                        : "border-transparent text-muted hover:text-ink-soft"
                    }`}
                  >
                    {t.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
        <p className="text-sm text-ink-soft mt-3">
          {scope === "next"
            ? "次クールに放送予定のTVアニメを放送局ごとに（局内は曜日・時刻順）。判明している放送枠のみ・配信は含みません。"
            : "選択した放送局で放送されるTVアニメ（地上波・BS/CS）を放送局ごとに（局内は曜日・時刻順）。配信は含みません。"}
          「登録」からカレンダー購読リストへ追加できます。深夜帯は前日の25:00〜表記です。
        </p>
      </div>

      {entries.length === 0 ? (
        <div className="card py-20 text-center">
          <p className="text-lg font-bold">表示できる放送予定がありません</p>
          <p className="text-sm text-muted mt-2">
            {scope === "next"
              ? "来季の放送枠はまだ判明していません。判明後に表示されます。"
              : "データの取り込み後に表示されます。"}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 pb-10">
          {orderedChannels.map((ch) => (
            <section key={ch} className="card overflow-hidden self-start">
              <div className="flex items-baseline gap-2 px-4 py-2.5 bg-paper border-b border-line">
                <h2 className="text-base font-black text-ink truncate">{ch}</h2>
                <span className="text-xs text-muted ml-auto tabular-nums shrink-0">
                  {byChannel.get(ch)!.length}本
                </span>
              </div>
              <ul className="divide-y divide-line">
                {byChannel.get(ch)!.map((e) => (
                  <li key={e.workId} className="flex gap-3 items-center px-3.5 py-2.5">
                    <span className="flex flex-col items-center shrink-0 w-12">
                      <span
                        className="text-[0.7rem] font-black leading-none"
                        style={{ color: DAY_COLOR[e.weekday] }}
                      >
                        {WEEKDAY_LABELS[e.weekday]}
                      </span>
                      <span className="font-black text-[0.82rem] text-ink tabular-nums leading-tight mt-0.5">
                        {e.slotLabel}
                      </span>
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
                        {e.count != null && `第${e.count}話`}
                        {e.count != null && e.popularity > 0 && " ・ "}
                        {e.popularity > 0 && `♥${formatPopularity(e.popularity)}`}
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
