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
import { SEASON_LABELS, SEASON_ORDER } from "@/lib/season";
import { formatPopularity } from "@/lib/format";
import { WorkCover } from "@/components/WorkCover";
import type { Season } from "@/lib/types";

export const metadata = { title: "アニメ分析" };
export const revalidate = 3600;

const SEASON_COLOR: Record<string, string> = {
  winter: "#5b7a99",
  spring: "#6f9466",
  summer: "#c2452d",
  autumn: "#b9772f",
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
  searchParams: Promise<{ period?: string }>;
}) {
  const sp = await searchParams;
  const curYear = new Date().getFullYear();
  const { filter, label, key } = parsePeriod(sp.period, curYear);

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

  // 期間ナビ用の最近クール
  const recentCools = volumeAll
    .slice()
    .reverse()
    .slice(0, 6)
    .map((v) => ({ key: `${v.season_year}-${v.season_name}`, label: `${String(v.season_year).slice(2)}${SEASON_LABELS[v.season_name]}` }));

  const periods = [
    { key: "all", label: "全期間" },
    { key: "1y", label: "直近1年" },
    { key: "3y", label: "直近3年" },
    ...recentCools,
  ];

  return (
    <div className="mx-auto max-w-6xl px-5 sm:px-8">
      <section className="pt-12 pb-5 border-b border-line">
        <p className="kicker">Industry analytics</p>
        <h1 className="display text-3xl sm:text-[2.4rem] leading-tight mt-3">アニメ分析</h1>
        <p className="text-ink-soft mt-3 max-w-2xl text-[0.92rem]">
          直近の放送作品をもとにした傾向分析。人気＝Annictウォッチャー数（国内）、スコア＝AniList（海外・100点）/ MyAnimeList（10点）。
        </p>
      </section>

      {/* 期間切替 */}
      <div className="py-5 flex flex-wrap items-center gap-2 border-b border-line">
        <span className="kicker mr-1">期間</span>
        {periods.map((p) => (
          <Link
            key={p.key}
            href={p.key === "all" ? "/analytics" : `/analytics?period=${p.key}`}
            className={`text-xs px-3 py-1 rounded-full border transition ${
              key === p.key ? "border-accent text-accent bg-accent/6" : "border-line-strong text-ink-soft hover:border-line"
            }`}
          >
            {p.label}
          </Link>
        ))}
      </div>

      <p className="text-sm text-ink-soft pt-6">
        対象期間: <span className="text-ink">{label}</span>
      </p>

      {/* 制作会社ランキング */}
      <Section title="制作会社ランキング" en="By studio" note="制作本数の多い順（カッコ内は平均人気度）">
        <BarList
          rows={studios.map((s) => ({
            label: s.studio,
            value: s.work_count,
            max: maxStudio,
            suffix: `${s.work_count}本 (${formatPopularity(s.avg_popularity)})`,
          }))}
          color="var(--color-accent)"
        />
      </Section>

      {/* 高評価ランキング（海外/MAL） */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-x-10 gap-y-8 py-10 border-b border-line">
        <RatedColumn title="高評価ランキング（海外 / AniList）" works={topAni} metric="anilist" />
        <RatedColumn title="高評価ランキング（MAL）" works={topMal} metric="mal" />
      </div>

      {/* 人気作品ランキング */}
      <Section title="人気作品ランキング" en="Most popular" note="Annictウォッチャー数（国内人気）">
        <RankGrid works={popular} metric="popularity" />
      </Section>

      {/* 声優出演数 */}
      <Section title="声優 出演数ランキング" en="By voice actor" note="出演作品数の多い順">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-1.5">
          {vas.map((v, i) => (
            <div key={v.person_name} className="flex items-center gap-3">
              <span className="w-6 text-right text-xs text-muted tabular-nums shrink-0">{i + 1}</span>
              <span className="w-28 truncate text-sm shrink-0">{v.person_name}</span>
              <div className="flex-1 min-w-0">
                <div className="h-3 bg-[var(--color-info)]/70 rounded-[1px]" style={{ width: `${Math.max(4, (v.work_count / maxVa) * 100)}%` }} />
              </div>
              <span className="text-xs text-ink-soft tabular-nums shrink-0 w-10 text-right">{v.work_count}</span>
            </div>
          ))}
        </div>
      </Section>

      {/* シーズン別本数推移（常に全期間） */}
      <Section title="シーズン別の本数推移" en="Volume by season" note="クールごとの放送本数（全期間）">
        <div className="flex items-end gap-[3px] sm:gap-1.5 overflow-x-auto pb-2 h-48">
          {volumeAll.map((v) => (
            <div key={`${v.season_year}-${v.season_name}`} className="flex flex-col items-center gap-1 shrink-0">
              <span className="text-[0.6rem] text-muted tabular-nums">{v.work_count}</span>
              <div
                className="w-3 sm:w-4 rounded-[1px]"
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
              <span className="w-2.5 h-2.5 rounded-[1px]" style={{ backgroundColor: SEASON_COLOR[s] }} />
              {SEASON_LABELS[s]}
            </span>
          ))}
        </div>
      </Section>

      <div className="h-16" />
    </div>
  );
}

function Section({ title, en, note, children }: { title: string; en: string; note?: string; children: React.ReactNode }) {
  return (
    <section className="py-10 border-b border-line">
      <div className="flex items-baseline gap-3 mb-1">
        <h2 className="display text-xl text-ink">{title}</h2>
        <span className="kicker">{en}</span>
      </div>
      {note && <p className="text-xs text-muted mb-5">{note}</p>}
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
          <span className="w-40 sm:w-56 truncate text-sm shrink-0">{r.label}</span>
          <div className="flex-1 min-w-0">
            <div className="h-4 rounded-[1px]" style={{ width: `${Math.max(3, (r.value / r.max) * 100)}%`, backgroundColor: color }} />
          </div>
          <span className="text-xs text-ink-soft tabular-nums shrink-0 w-24 text-right">{r.suffix}</span>
        </li>
      ))}
    </ul>
  );
}

function metricValue(w: RatedWork, metric: "popularity" | "anilist" | "mal"): string {
  if (metric === "anilist") return w.anilist_score != null ? `${w.anilist_score}/100` : "—";
  if (metric === "mal") return w.mal_score != null ? `${w.mal_score.toFixed(2)}` : "—";
  return `♡${formatPopularity(w.popularity)}`;
}

function RankGrid({ works, metric }: { works: RatedWork[]; metric: "popularity" | "anilist" | "mal" }) {
  if (works.length === 0) return <p className="text-sm text-muted">データがありません。</p>;
  return (
    <ol className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-8 gap-y-2">
      {works.map((w, i) => (
        <li key={w.id} className="flex items-center gap-2.5">
          <span className="w-5 text-right text-xs text-muted tabular-nums shrink-0">{i + 1}</span>
          <Link href={`/works/${w.id}`} className="shrink-0">
            <WorkCover id={w.id} title={w.title} url={w.posterUrl} className="w-7 h-10 rounded-[1px] border border-line" />
          </Link>
          <Link href={`/works/${w.id}`} className="flex-1 min-w-0 text-sm hover:text-accent transition truncate">
            {w.title}
          </Link>
          <span className="text-xs text-muted tabular-nums shrink-0">{metricValue(w, metric)}</span>
        </li>
      ))}
    </ol>
  );
}

function RatedColumn({ title, works, metric }: { title: string; works: RatedWork[]; metric: "anilist" | "mal" }) {
  return (
    <div>
      <h2 className="display text-lg text-ink border-b border-line-strong pb-1.5 mb-3">{title}</h2>
      {works.length === 0 ? (
        <p className="text-sm text-muted">スコア取得後に表示されます。</p>
      ) : (
        <ol className="space-y-2">
          {works.map((w, i) => (
            <li key={w.id} className="flex items-center gap-2.5">
              <span className="w-5 text-right text-xs text-muted tabular-nums shrink-0">{i + 1}</span>
              <Link href={`/works/${w.id}`} className="shrink-0">
                <WorkCover id={w.id} title={w.title} url={w.posterUrl} className="w-7 h-10 rounded-[1px] border border-line" />
              </Link>
              <Link href={`/works/${w.id}`} className="flex-1 min-w-0 text-sm hover:text-accent transition truncate">
                {w.title}
              </Link>
              <span className="display text-sm text-accent tabular-nums shrink-0">{metricValue(w, metric)}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
