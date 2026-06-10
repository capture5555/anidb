export const dynamic = "force-dynamic";
import Link from "next/link";
import {
  getStudioStats,
  getVaRanking,
  getSeasonVolume,
  getPopular,
  getTopRated,
  type Filter,
  type RatedWork,
} from "@/lib/analytics";
import { getRetentionSeries, getHotPrograms } from "@/lib/analytics/viewing";
import { RetentionChart } from "@/components/charts/RetentionChart";
import { HotProgramsPanel } from "@/components/charts/HotProgramsPanel";
import { SEASON_LABELS, SEASON_ORDER } from "@/lib/season";
import { formatPopularity } from "@/lib/format";
import { WorkCover } from "@/components/WorkCover";
import type { Season } from "@/lib/types";

export const metadata = { title: "アニメ分析" };
export const revalidate = 3600;

const SEASON_COLOR: Record<string, string> = {
  winter: "#5b7a99",
  spring: "#2ebd85",
  summer: "#e8482f",
  autumn: "#f5a623",
};

function parsePeriod(p: string | undefined, curYear: number): { filter: Filter; label: string; key: string } {
  if (p === "1y") return { filter: { sinceYear: curYear }, label: "直近1年", key: "1y" };
  if (p === "3y") return { filter: { sinceYear: curYear - 2 }, label: "直近3年", key: "3y" };
  const m = p?.match(/^(\d{4})-(winter|spring|summer|autumn)$/);
  if (m) {
    const season = m[2] as Season;
    return {
      filter: { year: Number(m[1]), season },
      label: `${m[1]}年 ${SEASON_LABELS[season]}`,
      key: p!,
    };
  }
  return { filter: {}, label: "全期間", key: "all" };
}

export default async function AnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; period?: string }>;
}) {
  const sp = await searchParams;
  const view = sp.view === "industry" ? "industry" : "viewing";

  return (
    <div className="mx-auto max-w-6xl px-4 sm:px-6">
      <div className="flex items-baseline gap-3 pt-8 mb-3">
        <h1 className="text-xl sm:text-2xl font-black text-ink">アニメ分析</h1>
      </div>

      {/* タブ */}
      <nav className="border-b-2 border-line mb-6">
        <ul className="flex gap-1 -mb-[2px]">
          <li>
            <Link
              href="/analytics"
              className={`inline-block px-5 sm:px-7 py-2.5 font-bold text-[0.95rem] border-b-[3px] transition-colors ${
                view === "viewing" ? "border-accent text-ink" : "border-transparent text-muted hover:text-ink-soft"
              }`}
            >
              視聴分析
            </Link>
          </li>
          <li>
            <Link
              href="/analytics?view=industry"
              className={`inline-block px-5 sm:px-7 py-2.5 font-bold text-[0.95rem] border-b-[3px] transition-colors ${
                view === "industry" ? "border-accent text-ink" : "border-transparent text-muted hover:text-ink-soft"
              }`}
            >
              業界データ
            </Link>
          </li>
        </ul>
      </nav>

      {view === "viewing" ? <ViewingSection /> : <IndustrySection period={sp.period} />}

      <div className="h-16" />
    </div>
  );
}

/* ================================================================ 視聴分析 */

async function ViewingSection() {
  const [retention, hot] = await Promise.all([
    getRetentionSeries(8).catch(() => ({ snapshotDate: null, series: [] })),
    getHotPrograms(6, 14).catch(() => []),
  ]);

  return (
    <div className="space-y-5">
      {/* 残留率 */}
      <section className="card p-5 sm:p-6">
        <h2 className="section-title text-lg mb-1">話数別の視聴継続率</h2>
        <p className="text-xs text-muted mb-5">
          今期人気作の「1話を記録した人を100%としたときの各話の記録数」。
          母数はAnnictの記録ユーザー（テレビ視聴率ではありません）。
          {retention.snapshotDate && ` 集計: ${retention.snapshotDate}時点`}
          ・放送4日未満の話は集計中のため除外
        </p>
        <RetentionChart series={retention.series} />
      </section>

      {/* 盛り上がり */}
      <section className="card p-5 sm:p-6">
        <h2 className="section-title text-lg mb-1">盛り上がった放送回（直近2週間）</h2>
        <p className="text-xs text-muted mb-5">
          ニコニコ実況のコメント数を分単位で集計し、コメント内容から「笑い・興奮・感動」などのリアクションを分類。
          ▲はコメントが集中したピーク。グラフにカーソルを合わせると内訳が見られます。
        </p>
        <HotProgramsPanel programs={hot} />
      </section>

      <p className="text-xs text-muted leading-relaxed">
        ※ データソース: Annict（記録数）・ニコニコ実況 過去ログAPI（コメント）。
        どちらも各サービスの利用者を母数とした参考値であり、テレビの視聴率・視聴者数を示すものではありません。
      </p>
    </div>
  );
}

/* ================================================================ 業界データ */

async function IndustrySection({ period }: { period?: string }) {
  const curYear = new Date().getFullYear();
  const { filter, label, key } = parsePeriod(period, curYear);

  const volumeAll = await getSeasonVolume();
  const [studios, vas, popular, topAni, topMal] = await Promise.all([
    getStudioStats(filter, 20),
    getVaRanking(filter, 24),
    getPopular(filter, 12),
    getTopRated(filter, "anilist", 12),
    getTopRated(filter, "mal", 12),
  ]);

  const maxStudio = Math.max(1, ...studios.map((s) => s.work_count));
  const maxVa = Math.max(1, ...vas.map((v) => v.work_count));
  const maxVol = Math.max(1, ...volumeAll.map((v) => v.work_count));

  const recentCools = volumeAll
    .slice()
    .reverse()
    .slice(0, 6)
    .map((v) => ({
      key: `${v.season_year}-${v.season_name}`,
      label: `${String(v.season_year).slice(2)}${SEASON_LABELS[v.season_name]}`,
    }));

  const periods = [
    { key: "all", label: "全期間" },
    { key: "1y", label: "直近1年" },
    { key: "3y", label: "直近3年" },
    ...recentCools,
  ];

  return (
    <div className="space-y-5">
      {/* 期間切替 */}
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-xs font-bold text-muted mr-1">期間</span>
        {periods.map((p) => (
          <Link
            key={p.key}
            href={p.key === "all" ? "/analytics?view=industry" : `/analytics?view=industry&period=${p.key}`}
            className={`text-xs font-medium px-3 py-1 rounded-full transition ${
              key === p.key
                ? "bg-ink text-white"
                : "bg-surface border border-line text-ink-soft hover:border-line-strong"
            }`}
          >
            {p.label}
          </Link>
        ))}
        <span className="text-xs text-muted ml-2">対象: {label}</span>
      </div>

      {/* 制作会社ランキング */}
      <Card title="制作会社ランキング" note="制作本数の多い順（カッコ内は平均人気度）">
        <BarList
          rows={studios.map((s) => ({
            label: s.studio,
            value: s.work_count,
            max: maxStudio,
            suffix: `${s.work_count}本 (${formatPopularity(s.avg_popularity)})`,
          }))}
          color="var(--color-primary)"
        />
      </Card>

      {/* 高評価ランキング */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <Card title="高評価ランキング（AniList）" note="海外ユーザー評価・100点満点">
          <RatedList works={topAni} metric="anilist" />
        </Card>
        <Card title="高評価ランキング（MyAnimeList）" note="世界最大級のDB・10点満点">
          <RatedList works={topMal} metric="mal" />
        </Card>
      </div>

      {/* 人気作品 */}
      <Card title="人気作品ランキング" note="Annictウォッチャー数（国内人気）">
        <RankGrid works={popular} metric="popularity" />
      </Card>

      {/* 声優出演数 */}
      <Card title="声優 出演数ランキング" note="出演作品数の多い順">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-1.5">
          {vas.map((v, i) => (
            <div key={v.person_name} className="flex items-center gap-3">
              <span className="w-6 text-right text-xs text-muted tabular-nums shrink-0">{i + 1}</span>
              <span className="w-28 truncate text-sm font-medium shrink-0">{v.person_name}</span>
              <div className="flex-1 min-w-0 bg-paper rounded-full h-3">
                <div
                  className="h-3 bg-primary/75 rounded-full"
                  style={{ width: `${Math.max(4, (v.work_count / maxVa) * 100)}%` }}
                />
              </div>
              <span className="text-xs text-ink-soft tabular-nums shrink-0 w-8 text-right">{v.work_count}</span>
            </div>
          ))}
        </div>
      </Card>

      {/* シーズン別本数推移 */}
      <Card title="シーズン別の放送本数" note="クールごとの放送本数（全期間）">
        <div className="flex items-end gap-[3px] sm:gap-1.5 overflow-x-auto pb-2 h-48">
          {volumeAll.map((v) => (
            <div key={`${v.season_year}-${v.season_name}`} className="flex flex-col items-center gap-1 shrink-0">
              <span className="text-[0.6rem] text-muted tabular-nums">{v.work_count}</span>
              <div
                className="w-3 sm:w-4 rounded-t"
                style={{ height: `${(v.work_count / maxVol) * 150}px`, backgroundColor: SEASON_COLOR[v.season_name] }}
                title={`${v.season_year}年 ${SEASON_LABELS[v.season_name]}: ${v.work_count}本`}
              />
              <span className="text-[0.55rem] text-muted">{SEASON_LABELS[v.season_name]}</span>
              <span className="text-[0.55rem] text-muted tabular-nums">{String(v.season_year).slice(2)}</span>
            </div>
          ))}
        </div>
        <div className="flex gap-4 mt-3 text-xs text-muted">
          {SEASON_ORDER.map((s) => (
            <span key={s} className="inline-flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-[2px]" style={{ backgroundColor: SEASON_COLOR[s] }} />
              {SEASON_LABELS[s]}
            </span>
          ))}
        </div>
      </Card>
    </div>
  );
}

function Card({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <section className="card p-5 sm:p-6">
      <h2 className="section-title text-lg mb-1">{title}</h2>
      {note && <p className="text-xs text-muted mb-4">{note}</p>}
      {children}
    </section>
  );
}

function BarList({ rows, color }: { rows: { label: string; value: number; max: number; suffix: string }[]; color: string }) {
  return (
    <ul className="space-y-1.5">
      {rows.map((r, i) => (
        <li key={r.label} className="flex items-center gap-3">
          <span className="w-6 text-right text-xs text-muted tabular-nums shrink-0">{i + 1}</span>
          <span className="w-40 sm:w-56 truncate text-sm font-medium shrink-0">{r.label}</span>
          <div className="flex-1 min-w-0 bg-paper rounded-full h-4">
            <div
              className="h-4 rounded-full"
              style={{ width: `${Math.max(3, (r.value / r.max) * 100)}%`, backgroundColor: color }}
            />
          </div>
          <span className="text-xs text-ink-soft tabular-nums shrink-0 w-24 text-right">{r.suffix}</span>
        </li>
      ))}
    </ul>
  );
}

function metricValue(w: RatedWork, metric: "popularity" | "anilist" | "mal"): string {
  if (metric === "anilist") return w.anilist_score != null ? `${w.anilist_score}` : "—";
  if (metric === "mal") return w.mal_score != null ? `${w.mal_score.toFixed(2)}` : "—";
  return formatPopularity(w.popularity);
}

function RankGrid({ works, metric }: { works: RatedWork[]; metric: "popularity" | "anilist" | "mal" }) {
  if (works.length === 0) return <p className="text-sm text-muted">データがありません。</p>;
  return (
    <ol className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-8 gap-y-2">
      {works.map((w, i) => (
        <li key={w.id} className="flex items-center gap-2.5">
          <span className={`w-5 text-right text-xs font-bold tabular-nums shrink-0 ${i < 3 ? "text-accent" : "text-muted"}`}>
            {i + 1}
          </span>
          <Link href={`/works/${w.id}`} className="shrink-0">
            <WorkCover id={w.id} title={w.title} url={w.posterUrl} className="w-8 h-11 rounded" />
          </Link>
          <Link href={`/works/${w.id}`} className="flex-1 min-w-0 text-sm font-medium hover:text-primary transition truncate">
            {w.title}
          </Link>
          <span className="text-xs text-muted tabular-nums shrink-0">{metricValue(w, metric)}</span>
        </li>
      ))}
    </ol>
  );
}

function RatedList({ works, metric }: { works: RatedWork[]; metric: "anilist" | "mal" }) {
  if (works.length === 0) return <p className="text-sm text-muted">スコア取得後に表示されます。</p>;
  return (
    <ol className="space-y-2">
      {works.map((w, i) => (
        <li key={w.id} className="flex items-center gap-2.5">
          <span className={`w-5 text-right text-xs font-bold tabular-nums shrink-0 ${i < 3 ? "text-accent" : "text-muted"}`}>
            {i + 1}
          </span>
          <Link href={`/works/${w.id}`} className="shrink-0">
            <WorkCover id={w.id} title={w.title} url={w.posterUrl} className="w-8 h-11 rounded" />
          </Link>
          <Link href={`/works/${w.id}`} className="flex-1 min-w-0 text-sm font-medium hover:text-primary transition truncate">
            {w.title}
          </Link>
          <span className="font-black text-sm text-primary tabular-nums shrink-0">{metricValue(w, metric)}</span>
        </li>
      ))}
    </ol>
  );
}
