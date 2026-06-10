export const dynamic = "force-dynamic";
import { getDataProvider } from "@/lib/data/provider";
import { SeasonTabs } from "@/components/SeasonTabs";
import { WorkCard } from "@/components/WorkCard";
import { FilterBar } from "@/components/FilterBar";
import { UpcomingStrip } from "@/components/UpcomingStrip";
import type { ListTab } from "@/lib/types";
import { seasonOf, nextSeason, formatSeason } from "@/lib/season";

const VALID_TABS: ListTab[] = ["this_season", "next_season", "movie"];

const TAB_LEAD: Record<ListTab, string> = {
  this_season: "いま放送中・放送予定のTV作品（人気順）",
  next_season: "次のクールに放送予定のTV作品（人気順）",
  movie: "劇場版・映画作品（人気順）",
};

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; q?: string; genre?: string }>;
}) {
  const sp = await searchParams;
  const tab: ListTab = VALID_TABS.includes(sp.tab as ListTab)
    ? (sp.tab as ListTab)
    : "this_season";
  const q = sp.q?.trim() || undefined;
  const genre = sp.genre?.trim() || undefined;

  const provider = await getDataProvider();
  const [{ items, total }, genres] = await Promise.all([
    provider.listWorks({ tab, q, genre, perPage: 500 }),
    provider.listGenres(),
  ]);

  const now = new Date();
  const cur = seasonOf(now);
  const nxt = nextSeason(cur.year, cur.season);
  const headingSeason =
    tab === "movie"
      ? "劇場版・映画"
      : tab === "next_season"
        ? formatSeason(nxt.year, nxt.season)
        : formatSeason(cur.year, cur.season);

  return (
    <div className="mx-auto max-w-6xl px-4 sm:px-6">
      {/* この後の放送（ミニ番組表） */}
      <UpcomingStrip />

      {/* タイトル行 + タブ */}
      <div className="mt-8">
        <div className="flex items-baseline gap-3 mb-3">
          <h1 className="text-xl sm:text-2xl font-black text-ink">{headingSeason}のアニメ</h1>
          <span className="text-xs text-muted tabular-nums">{total}作品</span>
        </div>
        <SeasonTabs active={tab} />
      </div>

      {/* 検索・ジャンル絞り込み */}
      <div className="pt-4">
        <FilterBar tab={tab} q={q} genre={genre} genres={genres} />
      </div>

      {/* 件数・条件 */}
      <p className="text-sm text-ink-soft pt-4 pb-4">
        {q ? `「${q}」の検索結果 — ${total}件` : genre ? `ジャンル「${genre}」 — ${total}件` : TAB_LEAD[tab]}
      </p>

      {/* グリッド */}
      {items.length > 0 ? (
        <ul className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 sm:gap-4 pb-16">
          {items.map((w) => (
            <li key={w.id}>
              <WorkCard work={w} />
            </li>
          ))}
        </ul>
      ) : (
        <div className="card py-20 text-center mb-16">
          <p className="text-lg font-bold text-ink">該当する作品がありません</p>
          <p className="text-sm text-muted mt-2">
            別のタブを選ぶか、しばらくしてからもう一度お試しください。
          </p>
        </div>
      )}
    </div>
  );
}
