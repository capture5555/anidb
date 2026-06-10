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
  this_season: "いま放送中・放送予定のTV作品です（人気順）。",
  next_season: "次のクールに放送予定のTV作品です（人気順）。",
  movie: "劇場版・映画作品です（人気順）。",
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
    <div className="mx-auto max-w-6xl px-5 sm:px-8">
      {/* マストヘッド */}
      <section className="pt-12 pb-8 border-b border-line">
        <p className="kicker">{headingSeason} のラインナップ</p>
        <h1 className="display text-3xl sm:text-[2.6rem] leading-tight mt-3 max-w-2xl">
          いま観られる、これから観られるアニメ。
        </h1>
        <p className="text-ink-soft mt-4 max-w-xl text-[0.95rem]">
          放送中・放送予定の作品をまとめて見渡せます。気になる作品は、詳細ページから必要な分だけGoogleカレンダーへ登録できます。
        </p>
      </section>

      {/* この後の放送（ミニ番組表） */}
      <UpcomingStrip />

      {/* タブ */}
      <div className="pt-7">
        <SeasonTabs active={tab} />
      </div>

      {/* 検索・ジャンル絞り込み */}
      <div className="pt-6">
        <FilterBar tab={tab} q={q} genre={genre} genres={genres} />
      </div>

      {/* 説明 + 件数 */}
      <div className="flex items-baseline justify-between pt-6 pb-5">
        <p className="text-sm text-ink-soft">
          {q ? `「${q}」の検索結果` : genre ? `ジャンル: ${genre}` : TAB_LEAD[tab]}
        </p>
        <p className="text-xs text-muted tabular-nums">{total} 作品</p>
      </div>

      {/* グリッド */}
      {items.length > 0 ? (
        <ul className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-x-5 gap-y-9 pb-16">
          {items.map((w) => (
            <li key={w.id}>
              <WorkCard work={w} />
            </li>
          ))}
        </ul>
      ) : (
        <div className="py-20 text-center">
          <p className="display text-xl text-ink">該当する作品がありません</p>
          <p className="text-sm text-muted mt-2">
            別のタブを選ぶか、しばらくしてからもう一度お試しください。
          </p>
        </div>
      )}
    </div>
  );
}
