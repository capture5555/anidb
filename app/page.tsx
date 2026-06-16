export const dynamic = "force-dynamic";
import Link from "next/link";
import { getDataProvider } from "@/lib/data/provider";
import { SeasonTabs } from "@/components/SeasonTabs";
import { WorkCard } from "@/components/WorkCard";
import { FilterBar } from "@/components/FilterBar";
import { UpcomingStrip } from "@/components/UpcomingStrip";
import type { ListTab } from "@/lib/types";
import { seasonOf, nextSeason, formatSeason } from "@/lib/season";
import { getLatestDailyNews } from "@/lib/analytics/news";
import { genreJa } from "@/lib/genres";

const VALID_TABS: ListTab[] = ["this_season", "next_season", "movie_now", "movie_upcoming"];

const TAB_LEAD: Record<ListTab, string> = {
  this_season: "いま放送中・放送予定のTV作品（人気順）",
  next_season: "次のクールに放送予定のTV作品（人気順）",
  movie_now: "上映中の劇場版・映画作品（公開日が新しい順）",
  movie_upcoming: "これから公開の劇場版・映画作品（公開日が近い順）",
};

const isMovieTab = (t: ListTab) => t === "movie_now" || t === "movie_upcoming";

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
  const [{ items, total }, genres, dailyNews] = await Promise.all([
    provider.listWorks({ tab, q, genre, perPage: 500 }),
    provider.listGenres(),
    getLatestDailyNews().catch(() => null),
  ]);

  const now = new Date();
  const cur = seasonOf(now);
  const nxt = nextSeason(cur.year, cur.season);
  const headingSeason = isMovieTab(tab)
    ? "劇場版・映画"
    : tab === "next_season"
      ? formatSeason(nxt.year, nxt.season)
      : formatSeason(cur.year, cur.season);

  return (
    <div className="mx-auto max-w-6xl px-4 sm:px-6">
      {/* この後の放送（ミニ番組表） */}
      <UpcomingStrip />

      {/* 今日のアニメニュース（データがある場合のみ表示） */}
      {dailyNews && (
        <section className="card mt-6 p-4 sm:p-5">
          <div className="flex items-baseline gap-3 mb-3">
            <h2 className="text-sm font-black text-ink">今日のアニメニュース</h2>
            <time
              dateTime={dailyNews.generatedAt}
              className="text-[0.68rem] text-muted tabular-nums"
            >
              {dailyNews.date}
            </time>
            <Link
              href="/analytics/ai-log?scope=news"
              className="ml-auto text-xs font-bold text-primary hover:underline underline-offset-2 shrink-0"
            >
              ニュース履歴 →
            </Link>
          </div>
          {dailyNews.body && !/^\d{4}-\d{2}-\d{2}のアニメ業界ニュース/.test(dailyNews.body) && (
            <p className="text-xs text-ink-soft leading-relaxed mb-3">{dailyNews.body}</p>
          )}
          <ol className="space-y-1.5">
            {dailyNews.items.map((item, i) => {
              const hasSummary = !!(item.summary && item.summary !== item.title);
              return (
                <li key={i} className="flex gap-2 items-start">
                  <span className="text-[0.68rem] font-black text-accent tabular-nums w-4 shrink-0 pt-px">
                    {i + 1}
                  </span>
                  <div className="min-w-0">
                    {item.url ? (
                      <a
                        href={item.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="block text-xs font-bold text-ink hover:text-primary transition leading-snug line-clamp-2"
                      >
                        {item.title}
                      </a>
                    ) : (
                      <p className="text-xs font-bold text-ink leading-snug line-clamp-2">
                        {item.title}
                      </p>
                    )}
                    {hasSummary && (
                      <p className="text-[0.72rem] text-muted leading-snug mt-0.5 line-clamp-3">
                        {item.summary}
                      </p>
                    )}
                  </div>
                </li>
              );
            })}
          </ol>
        </section>
      )}

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
        <FilterBar tab={tab} q={q} genre={genre} genres={[]} />
      </div>

      {/* 件数・条件 */}
      <p className="text-sm text-ink-soft pt-4 pb-4">
        {q ? `「${q}」の検索結果 — ${total}件` : genre ? `ジャンル「${genreJa(genre)}」 — ${total}件` : TAB_LEAD[tab]}
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
