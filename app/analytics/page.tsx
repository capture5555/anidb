import Link from "next/link";
import {
  getStudioStats,
  getVaRanking,
  getSeasonVolume,
  getPopularByYear,
  getYears,
} from "@/lib/analytics";
import { SEASON_LABELS } from "@/lib/season";
import { formatPopularity } from "@/lib/format";
import { WorkCover } from "@/components/WorkCover";

export const metadata = { title: "アニメ分析" };
export const revalidate = 3600;

export default async function AnalyticsPage() {
  const [studios, vas, volume, years] = await Promise.all([
    getStudioStats(25),
    getVaRanking(30),
    getSeasonVolume(),
    getYears(),
  ]);
  const topYears = years.slice(0, 6);
  const popularByYear = await Promise.all(topYears.map((y) => getPopularByYear(y, 10)));

  const maxStudio = Math.max(1, ...studios.map((s) => s.work_count));
  const maxVa = Math.max(1, ...vas.map((v) => v.work_count));
  const maxVol = Math.max(1, ...volume.map((v) => v.work_count));

  const totalWorks = volume.reduce((a, v) => a + v.work_count, 0);

  return (
    <div className="mx-auto max-w-6xl px-5 sm:px-8">
      <section className="pt-12 pb-6 border-b border-line">
        <p className="kicker">Industry analytics</p>
        <h1 className="display text-3xl sm:text-[2.4rem] leading-tight mt-3">アニメ分析</h1>
        <p className="text-ink-soft mt-3 max-w-2xl text-[0.95rem]">
          直近の放送作品（{years.length}年・{totalWorks.toLocaleString()}本）をもとにした、制作会社・声優・本数推移・人気の傾向。
          データ出典: Annict（人気度＝ウォッチャー数）。
        </p>
      </section>

      {/* 制作会社ランキング */}
      <Section title="制作会社ランキング" en="By studio" note="制作本数の多い順（カッコ内は平均人気度）">
        <ul className="space-y-1.5">
          {studios.map((s, i) => (
            <li key={s.studio} className="flex items-center gap-3">
              <span className="w-6 text-right text-xs text-muted tabular-nums shrink-0">{i + 1}</span>
              <span className="w-40 sm:w-56 truncate text-sm shrink-0">{s.studio}</span>
              <div className="flex-1 min-w-0">
                <div
                  className="h-4 bg-accent/80 rounded-[1px]"
                  style={{ width: `${Math.max(3, (s.work_count / maxStudio) * 100)}%` }}
                />
              </div>
              <span className="text-xs text-ink-soft tabular-nums shrink-0 w-24 text-right">
                {s.work_count}本
                <span className="text-muted"> ({formatPopularity(s.avg_popularity)})</span>
              </span>
            </li>
          ))}
        </ul>
      </Section>

      {/* シーズン別本数推移 */}
      <Section title="シーズン別の本数推移" en="Volume by season" note="クールごとの放送本数">
        <div className="flex items-end gap-[3px] sm:gap-1.5 overflow-x-auto pb-2 h-48">
          {volume.map((v) => (
            <div key={`${v.season_year}-${v.season_name}`} className="flex flex-col items-center gap-1 shrink-0">
              <span className="text-[0.6rem] text-muted tabular-nums">{v.work_count}</span>
              <div
                className="w-3 sm:w-4 rounded-[1px]"
                style={{
                  height: `${(v.work_count / maxVol) * 150}px`,
                  backgroundColor: SEASON_COLOR[v.season_name] ?? "#b4432b",
                }}
                title={`${v.season_year}年 ${SEASON_LABELS[v.season_name]}: ${v.work_count}本`}
              />
              <span className="text-[0.55rem] text-muted">{SEASON_LABELS[v.season_name]}</span>
              <span className="text-[0.55rem] text-muted tabular-nums">{String(v.season_year).slice(2)}</span>
            </div>
          ))}
        </div>
        <div className="flex gap-4 mt-3 text-xs text-muted">
          {(["winter", "spring", "summer", "autumn"] as const).map((s) => (
            <span key={s} className="inline-flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-[1px]" style={{ backgroundColor: SEASON_COLOR[s] }} />
              {SEASON_LABELS[s]}
            </span>
          ))}
        </div>
      </Section>

      {/* 声優出演数ランキング */}
      <Section title="声優 出演数ランキング" en="By voice actor" note="出演作品数の多い順（直近期間）">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-1.5">
          {vas.map((v, i) => (
            <div key={v.person_name} className="flex items-center gap-3">
              <span className="w-6 text-right text-xs text-muted tabular-nums shrink-0">{i + 1}</span>
              <span className="w-28 truncate text-sm shrink-0">{v.person_name}</span>
              <div className="flex-1 min-w-0">
                <div
                  className="h-3 bg-[var(--color-info)]/70 rounded-[1px]"
                  style={{ width: `${Math.max(4, (v.work_count / maxVa) * 100)}%` }}
                />
              </div>
              <span className="text-xs text-ink-soft tabular-nums shrink-0 w-10 text-right">{v.work_count}</span>
            </div>
          ))}
        </div>
      </Section>

      {/* 人気作品ランキング（年別） */}
      <Section title="人気作品ランキング" en="Most popular by year" note="年ごとの人気上位（ウォッチャー数）">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-x-8 gap-y-8">
          {topYears.map((year, idx) => (
            <div key={year}>
              <h3 className="display text-lg border-b border-line-strong pb-1.5 mb-3">{year}年</h3>
              <ol className="space-y-2">
                {popularByYear[idx].map((w, i) => (
                  <li key={w.id} className="flex items-center gap-2.5">
                    <span className="w-5 text-right text-xs text-muted tabular-nums shrink-0">{i + 1}</span>
                    <Link href={`/works/${w.id}`} className="shrink-0">
                      <WorkCover id={w.id} title={w.title} url={w.posterUrl} className="w-7 h-10 rounded-[1px] border border-line" />
                    </Link>
                    <Link href={`/works/${w.id}`} className="flex-1 min-w-0 text-sm hover:text-accent transition truncate">
                      {w.title}
                    </Link>
                    <span className="text-xs text-muted tabular-nums shrink-0">♡{formatPopularity(w.popularity)}</span>
                  </li>
                ))}
              </ol>
            </div>
          ))}
        </div>
      </Section>

      <div className="h-16" />
    </div>
  );
}

const SEASON_COLOR: Record<string, string> = {
  winter: "#5b7a99",
  spring: "#6f9466",
  summer: "#c2452d",
  autumn: "#b9772f",
};

function Section({
  title,
  en,
  note,
  children,
}: {
  title: string;
  en: string;
  note?: string;
  children: React.ReactNode;
}) {
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
