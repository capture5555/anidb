// searchParams (view, period, basis) make this page dynamically rendered per-request in Next.js 15
// regardless of any revalidate directive; we keep it dynamic but drop the conflicting directives.
// force-dynamic + revalidate=3600 was contradictory — force-dynamic won and revalidate was inert.
// With both removed the page is still dynamic (searchParams trigger per-request rendering),
// and the Workers/OpenNext edge layer can now apply response caching as configured there.
import Link from "next/link";
import {
  getVaRanking,
  getSeasonVolume,
  getPopular,
  getTopRated,
  type Filter,
  type RatedWork,
  type SeasonVolume,
  type VaStat,
} from "@/lib/analytics";
import { getStudioScorecards, type StudioScorecard } from "@/lib/analytics/studios";
import { getGenreInsights, type GenreInsight } from "@/lib/analytics/genres";
import { getFranchiseMomentum, type FranchiseGroup } from "@/lib/analytics/franchise";
import {
  getVoiceActorScorecards,
  getStaffScorecards,
  type VaScorecard,
  type StaffScorecard,
} from "@/lib/analytics/people";
import {
  getRetentionSeries,
  getJikkyoRetentionSeries,
  getHotPrograms,
  getPeakMoments,
  getReactionRatios,
  type ReactionRatioWork,
} from "@/lib/analytics/viewing";
import {
  getCoolScorecard,
  QUADRANT_LABELS,
  QUADRANT_NOTES,
  type ScorecardWork,
  type Quadrant,
} from "@/lib/analytics/scorecard";
import {
  getCoverageStats,
  getRecentJobs,
  getCollectionGaps,
  type CollectionJob,
  type CollectionGap,
} from "@/lib/analytics/collectionHealth";
import {
  getCohortXBuzz,
  getXBuzzVsJikkyo,
  type CohortXBuzz,
  type XBuzzVsJikkyo,
} from "@/lib/analytics/xbuzz";
import { seasonSummary, studioInsight, vaInsight, genreOpportunity, franchiseInsight, compareInsight, compareStaffInsight, toPercentileRank } from "@/lib/analytics/insights";
import {
  getTimeslotHeatmap,
  timeslotInsight,
  TIMESLOT_WEEKDAYS,
  type TimeslotHeatmap,
  type TimeslotCell,
} from "@/lib/analytics/timeslots";
import { AutoInsight } from "@/components/AutoInsight";
import { RetentionChart } from "@/components/charts/RetentionChart";
import { HotProgramsPanel } from "@/components/charts/HotProgramsPanel";
import { QuadrantScatter } from "@/components/charts/QuadrantScatter";
import { SEASON_LABELS, SEASON_ORDER } from "@/lib/season";
import { formatPopularity, formatAirShort } from "@/lib/format";
import { WorkCover } from "@/components/WorkCover";
import { CsvExportButton } from "@/components/CsvExportButton";
import type { Season } from "@/lib/types";

export const metadata = { title: "アニメ分析" };

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
  searchParams: Promise<{ view?: string; period?: string; basis?: string; compare?: string; comparestaff?: string }>;
}) {
  const sp = await searchParams;
  const view =
    sp.view === "industry"
      ? "industry"
      : sp.view === "scorecard"
        ? "scorecard"
        : sp.view === "people"
          ? "people"
          : sp.view === "collection"
            ? "collection"
            : sp.view === "buzz"
              ? "buzz"
              : "viewing";
  const basis = sp.basis === "annict" ? "annict" : "jikkyo";

  return (
    <div className="mx-auto max-w-6xl px-4 sm:px-6">
      <div className="flex items-baseline gap-3 pt-8 mb-3">
        <h1 className="text-xl sm:text-2xl font-black text-ink">アニメ分析</h1>
      </div>

      {/* タブ */}
      <nav className="border-b-2 border-line mb-6 overflow-x-auto">
        <ul className="flex gap-1 -mb-[2px]">
          {[
            { key: "viewing", href: "/analytics", label: "視聴分析" },
            { key: "scorecard", href: "/analytics?view=scorecard", label: "クール診断" },
            { key: "people", href: "/analytics?view=people", label: "人材" },
            { key: "buzz", href: "/analytics?view=buzz", label: "Xバズ" },
            { key: "industry", href: "/analytics?view=industry", label: "業界データ" },
            { key: "collection", href: "/analytics?view=collection", label: "収集状況" },
          ].map((t) => (
            <li key={t.key}>
              <Link
                href={t.href}
                className={`inline-block whitespace-nowrap px-4 sm:px-7 py-2.5 font-bold text-[0.95rem] border-b-[3px] transition-colors ${
                  view === t.key ? "border-accent text-ink" : "border-transparent text-muted hover:text-ink-soft"
                }`}
              >
                {t.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      {view === "viewing" ? (
        <ViewingSection basis={basis} />
      ) : view === "scorecard" ? (
        <ScorecardSection />
      ) : view === "people" ? (
        <PeopleSection compare={sp.compare} comparestaff={sp.comparestaff} />
      ) : view === "collection" ? (
        <CollectionSection />
      ) : view === "buzz" ? (
        <BuzzSection />
      ) : (
        <IndustrySection period={sp.period} />
      )}

      <div className="h-16" />
    </div>
  );
}

/* ================================================================ 視聴分析 */

async function ViewingSection({ basis }: { basis: "jikkyo" | "annict" }) {
  const [retention, hot, peaks, ratios, timeslots] = await Promise.all([
    basis === "annict"
      ? getRetentionSeries(8).catch(() => ({ snapshotDate: null, series: [] }))
      : getJikkyoRetentionSeries(8).catch(() => ({ snapshotDate: null, series: [] })),
    getHotPrograms(6, 14).catch(() => []),
    getPeakMoments(10).catch(() => []),
    getReactionRatios(1000).catch(() => []),
    getTimeslotHeatmap().catch((): TimeslotHeatmap => ({ cells: [], maxAvg: 0 })),
  ]);

  return (
    <div className="space-y-5">
      {/* 残留率 */}
      <section className="card p-5 sm:p-6">
        <div className="flex items-center justify-between gap-3 flex-wrap mb-1">
          <h2 className="section-title text-lg">話数別の視聴継続率</h2>
          <div className="flex gap-1.5">
            <Link
              href="/analytics"
              className={`text-xs font-bold px-3 py-1 rounded-full transition ${
                basis === "jikkyo" ? "bg-ink text-white" : "bg-surface border border-line text-ink-soft hover:border-line-strong"
              }`}
            >
              実況コメント基準
            </Link>
            <Link
              href="/analytics?basis=annict"
              className={`text-xs font-bold px-3 py-1 rounded-full transition ${
                basis === "annict" ? "bg-ink text-white" : "bg-surface border border-line text-ink-soft hover:border-line-strong"
              }`}
            >
              Annict記録基準
            </Link>
          </div>
        </div>
        <p className="text-xs text-muted mb-5">
          {basis === "annict" ? (
            <>
              今期人気作の「1話を記録した人を100%としたときの各話の記録数」。母数はAnnictの記録ユーザー
              （テレビ視聴率ではありません）。
              {retention.snapshotDate && ` 集計: ${retention.snapshotDate}時点`}
              ・放送4日未満の話は集計中のため除外
            </>
          ) : (
            <>
              今期人気作の「初回放送の実況コメント数を100%としたときの各話のコメント数」。
              母数はニコニコ実況のコメント（テレビ視聴率ではありません）。
              作品名をクリックすると話数ごとの詳細分析が見られます。
            </>
          )}
        </p>
        <RetentionChart series={retention.series} />
      </section>

      {/* クール残留カーブ一覧（small multiples） */}
      {retention.series.length > 0 && (
        <section className="card p-5 sm:p-6">
          <h2 className="section-title text-lg mb-1">クール残留カーブ一覧</h2>
          <p className="text-xs text-muted mb-4">
            今期人気作の残留率カーブを一覧で並べたミニグラフ。1話を100%としたときの推移を作品横断でひと目で比較できます。
            右端の数値は最新話の残留率。母数は
            {basis === "annict" ? "Annictの記録ユーザー" : "ニコニコ実況のコメント"}（テレビ視聴率ではありません）。
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            {retention.series.slice(0, 16).map((s) => (
              <RetentionMiniCard
                key={s.workId}
                workId={s.workId}
                title={s.title}
                pcts={s.points.map((p) => p.pct)}
              />
            ))}
          </div>
        </section>
      )}

      {/* 盛り上がり */}
      <section className="card p-5 sm:p-6">
        <h2 className="section-title text-lg mb-1">盛り上がった放送回（直近2週間）</h2>
        <p className="text-xs text-muted mb-5">
          ニコニコ実況のコメント数を分単位で集計し、コメント内容から「笑い・興奮・感動」などのリアクションを分類。
          ▲はコメントが集中したピーク。グラフにカーソルを合わせると内訳が見られます。
        </p>
        <HotProgramsPanel programs={hot} />
      </section>

      {/* 瞬間最大風速 */}
      {peaks.length > 0 && (
        <section className="card p-5 sm:p-6">
          <h2 className="section-title text-lg mb-1">瞬間最大風速ランキング（今期）</h2>
          <p className="text-xs text-muted mb-4">
            「1分間に流れたコメント数」の最大値が大きかった瞬間。その時に何が流れたかも見られます。
          </p>
          <ol className="divide-y divide-line">
            {peaks.map((p, i) => (
              <li key={p.programId} className="flex items-center gap-3 py-2.5">
                <span className={`w-6 text-center font-black tabular-nums shrink-0 ${i < 3 ? "text-accent" : "text-muted"}`}>
                  {i + 1}
                </span>
                <Link href={`/analytics/works/${p.workId}`} className="shrink-0">
                  <WorkCover id={p.workId} title={p.workTitle} url={p.posterUrl} className="w-9 h-12 rounded-md" />
                </Link>
                <div className="min-w-0 flex-1">
                  <Link
                    href={`/analytics/works/${p.workId}`}
                    className="block text-sm font-bold text-ink hover:text-primary transition truncate"
                  >
                    {p.workTitle}
                    <span className="font-normal text-ink-soft ml-1.5">{p.episodeLabel}</span>
                  </Link>
                  <p className="text-xs text-muted truncate">
                    開始{p.minute}分ごろ
                    {p.topComments.length > 0 &&
                      ` ─ ${p.topComments.map((c) => `「${c.text}」`).join(" ")}`}
                  </p>
                </div>
                <span className="shrink-0 text-right">
                  <span className="block font-black text-accent tabular-nums">{p.maxPerMinute.toLocaleString()}</span>
                  <span className="block text-[0.62rem] text-muted">コメ/分</span>
                </span>
              </li>
            ))}
          </ol>
        </section>
      )}

      {/* リアクション構成比ランキング */}
      {ratios.length > 2 && (
        <section className="card p-5 sm:p-6">
          <h2 className="section-title text-lg mb-1">リアクション別ランキング（今期）</h2>
          <p className="text-xs text-muted mb-4">
            実況コメントの内容を分類し、コメント全体に占める割合でランキング。母数は各作品の実況コメント総数（1,000コメント以上の作品が対象）。
          </p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-x-8 gap-y-6">
            <RatioColumn works={ratios} category="laugh" title="一番笑えるアニメ" color="#f5a623" label="笑い率" />
            <RatioColumn works={ratios} category="cry" title="一番泣けるアニメ" color="#2f6fdb" label="感動率" />
            <RatioColumn works={ratios} category="sakuga" title="作画が語られるアニメ" color="#2ebd85" label="作画言及率" />
          </div>
        </section>
      )}

      {/* 放送曜日×時間帯ヒートマップ */}
      <TimeslotHeatmapCard heatmap={timeslots} />

      <p className="text-xs text-muted leading-relaxed">
        ※ データソース: Annict（記録数）・ニコニコ実況 過去ログAPI（コメント）。
        どちらも各サービスの利用者を母数とした参考値であり、テレビの視聴率・視聴者数を示すものではありません。
      </p>
    </div>
  );
}

/* ---------------------------------------------------------------- 放送曜日×時間帯ヒートマップ */

/**
 * 放送曜日×時間帯ヒートマップ（サーバーコンポーネント）。
 * 行＝曜日(月..日)、列＝18時〜深夜3時(27時表記)。セル濃度＝平均コメント数/最大平均。
 */
function TimeslotHeatmapCard({ heatmap }: { heatmap: TimeslotHeatmap }) {
  const { cells, maxAvg } = heatmap;
  if (cells.length === 0 || maxAvg <= 0) return null;

  const HOURS = Array.from({ length: 10 }, (_, i) => 18 + i); // 18..27
  const byKey = new Map<string, TimeslotCell>();
  for (const c of cells) byKey.set(`${c.weekday}:${c.hour}`, c);

  // 27時表記ラベル（18..23 はそのまま、24..27 は「24時」等）
  const hourLabel = (h: number) => `${h}`;
  const insightLine = timeslotInsight(cells);

  return (
    <section className="card p-5 sm:p-6">
      <h2 className="section-title text-lg mb-1">放送曜日×時間帯ヒートマップ</h2>
      <p className="text-xs text-muted mb-1">
        放送中作品の本放送について、ニコニコ実況コメントの平均数で「枠の盛り上がり」を可視化。
        縦＝曜日(JST)、横＝18時〜深夜3時（25時＝翌1時の深夜表記）。
      </p>
      <p className="text-[0.68rem] text-muted mb-4 leading-relaxed">
        ※ 実況コメント平均による「枠の盛り上がり」。番組数が少ない枠はブレ大。
      </p>

      {insightLine && <AutoInsight lines={[insightLine]} />}

      <div className="overflow-x-auto">
        <table className="border-collapse" style={{ minWidth: 560 }}>
          <thead>
            <tr>
              <th className="w-8" />
              {HOURS.map((h) => (
                <th key={h} className="text-[0.6rem] font-bold text-muted px-0.5 pb-1 text-center tabular-nums">
                  {hourLabel(h)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {TIMESLOT_WEEKDAYS.map((dow, wi) => (
              <tr key={dow}>
                <td className="text-[0.7rem] font-bold text-ink-soft pr-2 text-right">{dow}</td>
                {HOURS.map((h) => {
                  const cell = byKey.get(`${wi}:${h}`);
                  if (!cell) {
                    return (
                      <td key={h} className="p-0.5">
                        <div className="w-full aspect-square rounded-[3px] bg-paper" style={{ minWidth: 28 }} />
                      </td>
                    );
                  }
                  const intensity = Math.min(1, cell.avgComments / maxAvg);
                  // 薄い→濃いの不透明度ステップ（accent blue）
                  const opacity = 0.12 + intensity * 0.88;
                  const title = `${dow}${h}時: 平均${cell.avgComments.toLocaleString()}コメ/${cell.programs}番組`;
                  return (
                    <td key={h} className="p-0.5">
                      <div
                        className="w-full aspect-square rounded-[3px]"
                        style={{ minWidth: 28, backgroundColor: `rgba(47, 111, 219, ${opacity})` }}
                        title={title}
                      />
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* 凡例 */}
      <div className="flex items-center gap-2 mt-3 text-[0.68rem] text-muted">
        <span>薄い=静か</span>
        <div className="flex">
          {[0.12, 0.34, 0.56, 0.78, 1].map((o) => (
            <div
              key={o}
              className="w-5 h-3 first:rounded-l-[2px] last:rounded-r-[2px]"
              style={{ backgroundColor: `rgba(47, 111, 219, ${o})` }}
            />
          ))}
        </div>
        <span>濃い=盛り上がる</span>
      </div>
    </section>
  );
}

function RatioColumn({
  works,
  category,
  title,
  color,
  label,
}: {
  works: ReactionRatioWork[];
  category: "laugh" | "cry" | "sakuga";
  title: string;
  color: string;
  label: string;
}) {
  const ranked = works
    .filter((w) => (w.ratios[category] ?? 0) > 0)
    .sort((a, b) => (b.ratios[category] ?? 0) - (a.ratios[category] ?? 0))
    .slice(0, 8);
  if (ranked.length === 0) return null;
  const max = ranked[0].ratios[category] ?? 1;

  return (
    <div>
      <h3 className="font-black text-[0.95rem] mb-2.5" style={{ color }}>
        {title}
      </h3>
      <ol className="space-y-2">
        {ranked.map((w, i) => (
          <li key={w.workId} className="flex items-center gap-2">
            <span className={`w-4 text-right text-xs font-bold tabular-nums shrink-0 ${i < 3 ? "text-ink" : "text-muted"}`}>
              {i + 1}
            </span>
            <div className="min-w-0 flex-1">
              <Link
                href={`/analytics/works/${w.workId}`}
                className="block text-xs font-bold text-ink hover:text-primary transition truncate"
              >
                {w.title}
              </Link>
              <div className="mt-0.5 bg-paper rounded-full h-2">
                <div
                  className="h-2 rounded-full"
                  style={{ width: `${Math.max(4, ((w.ratios[category] ?? 0) / max) * 100)}%`, backgroundColor: color }}
                />
              </div>
            </div>
            <span className="shrink-0 text-xs font-bold tabular-nums" style={{ color }}>
              {(w.ratios[category] ?? 0).toFixed(1)}%
            </span>
          </li>
        ))}
      </ol>
      <p className="text-[0.62rem] text-muted mt-1.5">{label} = 該当コメント数 ÷ 総コメント数</p>
    </div>
  );
}

/** 残留カーブのミニカード（small multiples 用, 静的SVGスパークライン）。 */
function RetentionMiniCard({
  workId,
  title,
  pcts,
}: {
  workId: string;
  title: string;
  pcts: number[];
}) {
  const last = pcts.length > 0 ? pcts[pcts.length - 1] : null;
  const W = 120;
  const H = 36;
  const PAD = 3;
  // 100%基準線を含めてスケール（残留率は100前後を行き来する）
  const vals = [...pcts, 100];
  const minV = Math.min(...vals);
  const maxV = Math.max(...vals);
  const range = maxV - minV || 1;
  const px = (i: number) =>
    pcts.length <= 1 ? W / 2 : PAD + (i / (pcts.length - 1)) * (W - PAD * 2);
  const py = (v: number) => PAD + (1 - (v - minV) / range) * (H - PAD * 2);
  const y100 = py(100);
  const points = pcts.map((v, i) => `${px(i).toFixed(1)},${py(v).toFixed(1)}`).join(" ");

  return (
    <Link
      href={`/analytics/works/${workId}`}
      className="block border border-line rounded-lg p-2.5 bg-paper hover:border-line-strong transition"
    >
      <p className="text-xs font-bold text-ink-soft truncate mb-1.5" title={title}>
        {title}
      </p>
      <div className="flex items-end justify-between gap-2">
        <svg
          width={W}
          height={H}
          viewBox={`0 0 ${W} ${H}`}
          aria-hidden="true"
          className="overflow-visible shrink-0"
        >
          {/* 100%基準線 */}
          <line x1={PAD} x2={W - PAD} y1={y100} y2={y100} stroke="#d4d8e0" strokeWidth="1" />
          {pcts.length >= 2 && (
            <polyline
              points={points}
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinejoin="round"
              strokeLinecap="round"
              className="text-accent"
            />
          )}
          {last != null && (
            <circle
              cx={px(pcts.length - 1).toFixed(1)}
              cy={py(last).toFixed(1)}
              r="2"
              className="fill-current text-accent"
            />
          )}
        </svg>
        <span className="text-xs font-black text-accent tabular-nums shrink-0">
          {last != null ? `${Math.round(last)}%` : "—"}
        </span>
      </div>
    </Link>
  );
}

/* ================================================================ Xバズ */

/** sentiment を emerald/amber/rose のチップにマップ（Xバズ用）。未知/欠落は非表示。 */
function BuzzSentimentChip({ sentiment }: { sentiment: string | null }) {
  if (!sentiment) return null;
  const s = sentiment.toLowerCase();
  const config: { cls: string; label: string } | null =
    s === "positive"
      ? { cls: "bg-emerald-100 text-emerald-700", label: "ポジティブ" }
      : s === "mixed"
        ? { cls: "bg-amber-100 text-amber-700", label: "賛否両論" }
        : s === "negative"
          ? { cls: "bg-rose-100 text-rose-700", label: "ネガティブ" }
          : null;
  if (!config) return null;
  return (
    <span
      className={`inline-block text-[0.66rem] font-bold px-2 py-0.5 rounded-full whitespace-nowrap ${config.cls}`}
    >
      {config.label}
    </span>
  );
}

/** volume 0-5 を5セグメントのゲージで表現（Xバズ用）。 */
function BuzzVolumeGauge({ volume }: { volume: number }) {
  const filled = Math.max(0, Math.min(5, Math.round(volume)));
  return (
    <div className="flex items-center gap-0.5" aria-label={`盛り上がり ${filled}/5`}>
      {[0, 1, 2, 3, 4].map((i) => (
        <span
          key={i}
          className={`h-2.5 w-4 rounded-[2px] ${i < filled ? "bg-accent" : "bg-paper"}`}
        />
      ))}
    </div>
  );
}

async function BuzzSection() {
  const [cohort, vsJikkyo] = await Promise.all([
    getCohortXBuzz(20).catch((): CohortXBuzz[] => []),
    getXBuzzVsJikkyo(30).catch((): XBuzzVsJikkyo[] => []),
  ]);

  return (
    <div className="space-y-5">
      {/* クール内Xバズランキング */}
      <section className="card p-5 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-3 mb-1">
          <h2 className="section-title text-lg">クール内Xバズランキング</h2>
          {cohort.length > 0 && (
            <CsvExportButton
              filename="Xバズランキング"
              headers={["順位", "作品", "盛り上がり", "センチメント"]}
              rows={cohort.map((c, i) => [i + 1, c.title, c.volume, c.sentiment ?? ""])}
            />
          )}
        </div>
        <p className="text-xs text-muted mb-4">
          今期放送中作品の最新Xバズ（Grok x_search 分析の volume 0〜5）を降順に表示。母数はXの投稿で、ニコニコ実況とは異なります。
        </p>
        {cohort.length === 0 ? (
          <p className="text-sm text-muted">
            Xバズのデータがまだ十分に集まっていません。収集が進むと表示されます。
          </p>
        ) : (
          <ol className="divide-y divide-line">
            {cohort.map((c, i) => (
              <li key={c.workId} className="flex items-center gap-3 py-2.5">
                <span
                  className={`w-5 text-right font-black tabular-nums shrink-0 ${
                    i < 3 ? "text-accent" : "text-muted"
                  }`}
                >
                  {i + 1}
                </span>
                <Link href={`/analytics/works/${c.workId}`} className="shrink-0">
                  <WorkCover id={c.workId} title={c.title} url={c.posterUrl} className="w-9 h-12 rounded-md" />
                </Link>
                <Link
                  href={`/analytics/works/${c.workId}`}
                  className="flex-1 min-w-0 text-sm font-bold text-ink hover:text-primary transition truncate"
                >
                  {c.title}
                </Link>
                <BuzzVolumeGauge volume={c.volume} />
                <span className="text-xs font-bold text-ink-soft tabular-nums shrink-0 w-7 text-right">
                  {Math.max(0, Math.min(5, Math.round(c.volume)))}/5
                </span>
                <BuzzSentimentChip sentiment={c.sentiment} />
              </li>
            ))}
          </ol>
        )}
      </section>

      {/* ニコ実況 × X 相関 */}
      <section className="card p-5 sm:p-6">
        <h2 className="section-title text-lg mb-1">ニコ実況 × X 相関</h2>
        <p className="text-xs text-muted mb-4">
          横＝ニコニコ実況のコメント総数（平方根スケール）、縦＝最新Xバズ volume（0〜5）。
          実況とXは母数（利用者層）が異なるため、両軸で位置づけを見ると「実況で熱いがXは静か」「Xで話題だが実況は静か（隠れ人気）」といった偏りが分かります。
        </p>
        {vsJikkyo.length === 0 ? (
          <p className="text-sm text-muted">
            相関に必要なデータがまだ十分に集まっていません。収集が進むと表示されます。
          </p>
        ) : (
          <BuzzJikkyoScatter points={vsJikkyo} />
        )}
      </section>

      <p className="text-xs text-muted leading-relaxed">
        ※ データは3hごとに収集・数日かけて蓄積。Grok の x_search 分析に基づく参考値であり、テレビ視聴率ではありません。
      </p>
    </div>
  );
}

/** ニコ実況コメント数(x, sqrtスケール) × Xバズ volume(y) の散布図（インラインSVG）。 */
function BuzzJikkyoScatter({ points }: { points: XBuzzVsJikkyo[] }) {
  const W = 560;
  const H = 320;
  const PAD = { top: 16, right: 16, bottom: 36, left: 40 };
  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;

  const maxComments = Math.max(1, ...points.map((p) => p.jikkyoComments));
  const sqrtMax = Math.sqrt(maxComments);
  const px = (comments: number) => PAD.left + (Math.sqrt(Math.max(0, comments)) / sqrtMax) * innerW;
  const py = (vol: number) => PAD.top + (1 - Math.max(0, Math.min(5, vol)) / 5) * innerH;

  const midX = PAD.left + innerW / 2;
  const midY = PAD.top + innerH / 2;

  return (
    <div className="overflow-x-auto">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full min-w-[480px]"
        role="img"
        aria-label="ニコ実況コメント数とXバズの散布図"
      >
        {/* 軸 */}
        <line x1={PAD.left} x2={PAD.left} y1={PAD.top} y2={H - PAD.bottom} stroke="#e8eaef" />
        <line
          x1={PAD.left}
          x2={W - PAD.right}
          y1={H - PAD.bottom}
          y2={H - PAD.bottom}
          stroke="#e8eaef"
        />
        {/* 中央十字（四象限の境界） */}
        <line x1={midX} x2={midX} y1={PAD.top} y2={H - PAD.bottom} stroke="#f0f1f4" strokeDasharray="3 3" />
        <line x1={PAD.left} x2={W - PAD.right} y1={midY} y2={midY} stroke="#f0f1f4" strokeDasharray="3 3" />

        {/* 象限注記 */}
        <text x={W - PAD.right - 4} y={H - PAD.bottom - 8} textAnchor="end" fontSize="9" fill="#a0a6b0">
          右下=実況で熱いがXは静か
        </text>
        <text x={PAD.left + 4} y={PAD.top + 12} textAnchor="start" fontSize="9" fill="#a0a6b0">
          左上=Xで話題だが実況は静か（隠れ人気）
        </text>

        {/* 軸ラベル */}
        <text x={PAD.left + innerW / 2} y={H - 6} textAnchor="middle" fontSize="10" fill="#8a909c">
          ニコ実況コメント数（√スケール）→
        </text>

        {/* 点 */}
        {points.map((p) => (
          <circle
            key={p.workId}
            cx={px(p.jikkyoComments).toFixed(1)}
            cy={py(p.xVolume).toFixed(1)}
            r="4.5"
            fill="#2f6fdb"
            fillOpacity="0.65"
          >
            <title>{`${p.title} ─ 実況${p.jikkyoComments.toLocaleString()}コメ / Xバズ${Math.round(p.xVolume)}/5`}</title>
          </circle>
        ))}

        {/* y軸目盛 */}
        {[0, 1, 2, 3, 4, 5].map((v) => (
          <text
            key={v}
            x={PAD.left - 6}
            y={py(v) + 3}
            textAnchor="end"
            fontSize="9"
            fill="#8a909c"
          >
            {v}
          </text>
        ))}
      </svg>
    </div>
  );
}

/* ================================================================ クール診断 */

async function ScorecardSection() {
  const card = await getCoolScorecard().catch(() => null);

  if (!card || card.works.length === 0) {
    return (
      <div className="card p-8 text-center text-sm text-muted">
        クール診断に必要な実況データがまだ十分に集まっていません。収集が進むと表示されます。
      </div>
    );
  }

  const seasonLabel = `${card.year}年 ${SEASON_LABELS[card.season]}`;
  const points = card.works.map((w) => ({
    workId: w.workId,
    title: w.title,
    x: w.awarenessDev,
    y: w.passionDev,
    overall: w.overall,
  }));

  const darkhorses = card.works
    .filter((w) => w.darkhorse > 0)
    .sort((a, b) => b.darkhorse - a.darkhorse)
    .slice(0, 5);

  const quadrants: Quadrant[] = ["royal", "wordofmouth", "fastburn", "niche"];

  return (
    <div className="space-y-5">
      {/* 概要 */}
      <section className="card p-5 sm:p-6">
        <h2 className="section-title text-lg mb-1">クール診断（{seasonLabel}）</h2>
        <p className="text-xs text-muted leading-relaxed">
          今期の放送中作品を<strong>クール内で相対化</strong>し、認知規模・熱量・定着力・満足度から
          総合偏差値（平均50）を算出。実況データのある<strong>{card.withData}作品</strong>が対象
          （放送中 {card.totalAiring} 作品中）。
          <br />
          認知規模＝Annictウォッチャー数、熱量＝ニコニコ実況のコメント総数を代替指標としています。
          検索量・SNS投稿量・タイムシフト比率は取得できないため算出していません。テレビ視聴率ではありません。
        </p>
        <div className="mt-4">
          <AutoInsight lines={seasonSummary(card)} />
        </div>
      </section>

      {/* 散布図 */}
      <section className="card p-5 sm:p-6">
        <h2 className="section-title text-lg mb-1">認知度 × 熱量 マップ</h2>
        <p className="text-xs text-muted mb-4">
          横＝どれだけ広く知られているか、縦＝どれだけ濃く語られているか（どちらも偏差値）。
          点の大きさは総合偏差値。点をクリックすると作品ページへ。
        </p>
        <QuadrantScatter points={points} />
      </section>

      {/* 発掘ビュー（評価 × 認知） */}
      <DiscoveryView works={card.works} />

      {/* 偏差値ランキング表 */}
      <section className="card p-5 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-3 mb-1">
          <h2 className="section-title text-lg">偏差値カルテ（総合順）</h2>
          <CsvExportButton
            filename={`クール診断_偏差値カルテ_${card.year}_${card.season}`}
            headers={["順位", "作品", "総合", "認知", "熱量", "熱量密度", "定着", "満足", "タイプ"]}
            rows={card.works.slice(0, 24).map((w, i) => [
              i + 1,
              w.title,
              w.overall,
              w.awarenessDev,
              w.passionDev,
              w.densityDev,
              w.retentionDev,
              w.satisfactionDev,
              QUADRANT_LABELS[w.quadrant],
            ])}
          />
        </div>
        <p className="text-xs text-muted mb-4">
          各指標はクール内の偏差値（平均50）。熱量密度＝コメント数÷認知規模（規模の割に濃く語られているか）。
          定着＝直近話の実況コメント÷初回話。
        </p>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[680px] text-sm border-collapse">
            <thead>
              <tr className="text-xs text-muted border-b border-line">
                <th className="text-left font-bold py-2 pr-2 w-7">#</th>
                <th className="text-left font-bold py-2 pr-3">作品</th>
                <Th>総合</Th>
                <Th>認知</Th>
                <Th>熱量</Th>
                <Th>熱量密度</Th>
                <Th>定着</Th>
                <Th>満足</Th>
                <th className="text-left font-bold py-2 pl-3 pr-2">タイプ</th>
              </tr>
            </thead>
            <tbody>
              {card.works.slice(0, 24).map((w, i) => (
                <tr key={w.workId} className="border-b border-line/60 hover:bg-paper/60">
                  <td className="py-2 pr-2 text-xs text-muted tabular-nums">{i + 1}</td>
                  <td className="py-2 pr-3">
                    <Link
                      href={`/works/${w.workId}`}
                      className="font-medium text-ink hover:text-primary transition line-clamp-1"
                    >
                      {w.title}
                    </Link>
                  </td>
                  <DevCell value={w.overall} strong />
                  <DevCell value={w.awarenessDev} />
                  <DevCell value={w.passionDev} />
                  <DevCell value={w.densityDev} />
                  <DevCell value={w.retentionDev} />
                  <DevCell value={w.satisfactionDev} />
                  <td className="py-2 pl-3 pr-2">
                    <QuadrantTag q={w.quadrant} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* ダークホース */}
      {darkhorses.length > 0 && (
        <section className="card p-5 sm:p-6">
          <h2 className="section-title text-lg mb-1">ダークホース指数 TOP</h2>
          <p className="text-xs text-muted mb-4">
            「熱量の順位 − 認知の順位」がプラスの作品＝<strong>知名度の割に濃く語られている</strong>。
            伸びしろの目安です。
          </p>
          <ol className="space-y-2">
            {darkhorses.map((w, i) => (
              <li key={w.workId} className="flex items-center gap-3">
                <span className={`w-5 text-right font-black tabular-nums shrink-0 ${i < 3 ? "text-accent" : "text-muted"}`}>
                  {i + 1}
                </span>
                <Link
                  href={`/works/${w.workId}`}
                  className="flex-1 min-w-0 text-sm font-medium text-ink hover:text-primary transition truncate"
                >
                  {w.title}
                </Link>
                <span className="text-xs text-muted tabular-nums shrink-0">
                  熱量{w.passionDev} / 認知{w.awarenessDev}
                </span>
                <span className="text-sm font-black text-accent tabular-nums shrink-0 w-10 text-right">
                  +{w.darkhorse}
                </span>
              </li>
            ))}
          </ol>
        </section>
      )}


      {/* 4象限の作品リスト */}
      <section className="card p-5 sm:p-6">
        <h2 className="section-title text-lg mb-4">タイプ別の作品</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
          {quadrants.map((q) => {
            const list = card.works.filter((w) => w.quadrant === q);
            return (
              <div key={q} className="border border-line rounded-lg p-4">
                <div className="flex items-center gap-2 mb-1">
                  <QuadrantTag q={q} />
                  <span className="text-xs text-muted tabular-nums">{list.length}作品</span>
                </div>
                <p className="text-[0.7rem] text-muted mb-2.5 leading-relaxed">{QUADRANT_NOTES[q]}</p>
                <ul className="space-y-1">
                  {list.slice(0, 6).map((w) => (
                    <li key={w.workId} className="text-xs">
                      <Link href={`/works/${w.workId}`} className="text-ink-soft hover:text-primary transition truncate block">
                        ・{w.title}
                      </Link>
                    </li>
                  ))}
                  {list.length === 0 && <li className="text-xs text-muted">該当なし</li>}
                </ul>
              </div>
            );
          })}
        </div>
      </section>

      <p className="text-xs text-muted leading-relaxed">
        ※ 1クールのスナップショットに過ぎず、放送途中のため確定値ではありません。
        各指標は各サービス利用者を母数とした参考値です。
      </p>
    </div>
  );
}

/* ---------------------------------------------------------------- 発掘ビュー */

function DiscoveryView({ works }: { works: ScorecardWork[] }) {
  const sleepers = works
    .filter((w) => w.sleeper && w.scoreDev != null)
    .sort((a, b) => (b.scoreDev! - b.awarenessDev) - (a.scoreDev! - a.awarenessDev))
    .slice(0, 8);

  const overhyped = works
    .filter((w) => w.overhyped && w.scoreDev != null)
    .sort((a, b) => (b.awarenessDev - b.scoreDev!) - (a.awarenessDev - a.scoreDev!))
    .slice(0, 6);

  if (sleepers.length === 0 && overhyped.length === 0) return null;

  const scatterPoints = works
    .filter((w) => w.scoreDev != null)
    .map((w) => ({
      workId: w.workId,
      title: w.title,
      x: w.awarenessDev,
      y: w.scoreDev as number,
      overall: w.overall,
    }));

  return (
    <section className="card p-5 sm:p-6">
      <h2 className="section-title text-lg mb-1">発掘ビュー（評価 × 認知）</h2>

      {/* 認知 × 評価 散布図 */}
      {scatterPoints.length > 0 && (
        <div className="mb-6">
          <QuadrantScatter points={scatterPoints} />
          <p className="text-[0.68rem] text-muted mt-2 leading-relaxed">
            横＝認知偏差値、縦＝評価偏差値。
            左上（高評価・低認知）＝発掘候補（スリーパー）、右下（高認知・低評価）＝話題先行。
          </p>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* 発掘候補ランキング */}
        {sleepers.length > 0 && (
          <div>
            <h3 className="font-black text-[0.92rem] text-emerald-600 mb-1">
              発掘候補（スリーパー）
            </h3>
            <p className="text-[0.68rem] text-muted mb-3 leading-relaxed">
              高評価だが認知が追いついていない作品。評価−認知ギャップが大きい順。
            </p>
            <ol className="divide-y divide-line">
              {sleepers.map((w, i) => {
                const gap = (w.scoreDev! - w.awarenessDev).toFixed(1);
                return (
                  <li key={w.workId} className="flex items-center gap-3 py-2">
                    <span
                      className={`w-5 text-right font-black tabular-nums shrink-0 ${
                        i < 3 ? "text-accent" : "text-muted"
                      }`}
                    >
                      {i + 1}
                    </span>
                    <Link
                      href={`/analytics/works/${w.workId}`}
                      className="flex-1 min-w-0 text-sm font-medium text-ink hover:text-primary transition truncate"
                    >
                      {w.title}
                    </Link>
                    <span className="text-xs text-muted tabular-nums shrink-0 whitespace-nowrap">
                      評価{w.scoreDev!.toFixed(0)} / 認知{w.awarenessDev.toFixed(0)}
                    </span>
                    <span className="text-xs font-black text-emerald-600 tabular-nums shrink-0 w-14 text-right whitespace-nowrap">
                      +{gap}
                    </span>
                  </li>
                );
              })}
            </ol>
            <p className="text-[0.62rem] text-muted mt-1.5">評価−認知 = ギャップ偏差値</p>
          </div>
        )}

        {/* 話題先行ランキング */}
        {overhyped.length > 0 && (
          <div>
            <h3 className="font-black text-[0.92rem] text-amber-500 mb-1">
              話題先行（過大評価）
            </h3>
            <p className="text-[0.68rem] text-muted mb-3 leading-relaxed">
              認知は高いが評価が伴わない作品。認知−評価ギャップが大きい順。
            </p>
            <ol className="divide-y divide-line">
              {overhyped.map((w, i) => {
                const gap = (w.awarenessDev - w.scoreDev!).toFixed(1);
                return (
                  <li key={w.workId} className="flex items-center gap-3 py-2">
                    <span
                      className={`w-5 text-right font-black tabular-nums shrink-0 ${
                        i < 3 ? "text-accent" : "text-muted"
                      }`}
                    >
                      {i + 1}
                    </span>
                    <Link
                      href={`/analytics/works/${w.workId}`}
                      className="flex-1 min-w-0 text-sm font-medium text-ink hover:text-primary transition truncate"
                    >
                      {w.title}
                    </Link>
                    <span className="text-xs text-muted tabular-nums shrink-0 whitespace-nowrap">
                      認知{w.awarenessDev.toFixed(0)} / 評価{w.scoreDev!.toFixed(0)}
                    </span>
                    <span className="text-xs font-black text-amber-500 tabular-nums shrink-0 w-14 text-right whitespace-nowrap">
                      +{gap}
                    </span>
                  </li>
                );
              })}
            </ol>
            <p className="text-[0.62rem] text-muted mt-1.5">認知−評価 = ギャップ偏差値</p>
          </div>
        )}
      </div>
    </section>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return <th className="text-center font-bold py-2 px-1 w-14">{children}</th>;
}

function DevCell({ value, strong = false }: { value: number | null; strong?: boolean }) {
  if (value == null) {
    return <td className="py-2 px-1 text-center text-xs text-muted">—</td>;
  }
  // 50を基準に色付け（高い=朱寄り、低い=鈍色）
  const hot = value >= 60;
  const warm = value >= 50;
  const color = hot ? "text-accent" : warm ? "text-ink" : "text-muted";
  return (
    <td className={`py-2 px-1 text-center tabular-nums ${strong ? "font-black" : "font-medium"} ${color}`}>
      {value.toFixed(0)}
    </td>
  );
}

function QuadrantTag({ q }: { q: Quadrant }) {
  const color: Record<Quadrant, string> = {
    royal: "#e8482f",
    wordofmouth: "#2ebd85",
    fastburn: "#f5a623",
    niche: "#9b59b6",
  };
  return (
    <span
      className="inline-block text-[0.66rem] font-bold px-2 py-0.5 rounded-full text-white whitespace-nowrap"
      style={{ backgroundColor: color[q] }}
    >
      {QUADRANT_LABELS[q]}
    </span>
  );
}

/* ================================================================ 人材 */

/** URLSearchParams から compare 名リストを抽出（最大 3 件）。*/
function parseCompareNames(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((n) => decodeURIComponent(n.trim()))
    .filter(Boolean)
    .slice(0, 3);
}

/** 現在の compare リストに name を追加した URL を返す（既存は除去、上限3）。 */
function buildCompareHref(currentNames: string[], name: string, base: string): string {
  const params = new URLSearchParams(base);
  // already selected → remove
  if (currentNames.includes(name)) {
    const next = currentNames.filter((n) => n !== name);
    if (next.length > 0) {
      params.set("compare", next.map(encodeURIComponent).join(","));
    } else {
      params.delete("compare");
    }
  } else if (currentNames.length < 3) {
    const next = [...currentNames, name];
    params.set("compare", next.map(encodeURIComponent).join(","));
  } else {
    // cap reached — replace oldest
    const next = [...currentNames.slice(1), name];
    params.set("compare", next.map(encodeURIComponent).join(","));
  }
  return `/analytics?${params.toString()}`;
}

/** compare=all-cleared URL */
function buildClearHref(base: string): string {
  const params = new URLSearchParams(base);
  params.delete("compare");
  return `/analytics?${params.toString()}`;
}

/** comparestaff clear URL */
function buildClearStaffHref(base: string): string {
  const params = new URLSearchParams(base);
  params.delete("comparestaff");
  return `/analytics?${params.toString()}`;
}

/** staff compare href builder for a bucket */
function buildStaffCompareHref(
  currentRaw: string | undefined,
  roleKey: string,
  name: string,
  base: string,
): string {
  const params = new URLSearchParams(base);
  // Parse current: "roleKey:name1,name2"
  const [curRole, curNamesRaw] = currentRaw ? currentRaw.split(":") : ["", ""];
  const curNames: string[] =
    curRole === roleKey && curNamesRaw
      ? curNamesRaw
          .split(",")
          .map((n) => decodeURIComponent(n.trim()))
          .filter(Boolean)
          .slice(0, 3)
      : [];

  let next: string[];
  if (curNames.includes(name)) {
    next = curNames.filter((n) => n !== name);
  } else if (curNames.length < 3) {
    next = [...curNames, name];
  } else {
    next = [...curNames.slice(1), name];
  }

  if (next.length === 0) {
    params.delete("comparestaff");
  } else {
    params.set(
      "comparestaff",
      `${roleKey}:${next.map(encodeURIComponent).join(",")}`,
    );
  }
  return `/analytics?${params.toString()}`;
}

/** Base query string preserving view=people (and other params) */
function peopleSp(compare?: string, comparestaff?: string): string {
  const p = new URLSearchParams();
  p.set("view", "people");
  if (compare) p.set("compare", compare);
  if (comparestaff) p.set("comparestaff", comparestaff);
  return p.toString();
}

async function PeopleSection({
  compare,
  comparestaff,
}: {
  compare?: string;
  comparestaff?: string;
}) {
  const [vas, staffBuckets] = await Promise.all([
    getVoiceActorScorecards({ limit: 30 }).catch(() => []),
    getStaffScorecards({ limit: 15 }).catch(() => []),
  ]);

  const compareNames = parseCompareNames(compare);
  const baseSp = peopleSp(compare, comparestaff);

  // Staff compare: parse "roleKey:name1,name2"
  const [staffRoleKey, staffNamesRaw] = comparestaff ? comparestaff.split(":") : ["", ""];
  const staffCompareNames: string[] =
    staffRoleKey && staffNamesRaw
      ? staffNamesRaw
          .split(",")
          .map((n) => decodeURIComponent(n.trim()))
          .filter(Boolean)
          .slice(0, 3)
      : [];

  return (
    <div className="space-y-5">
      {/* 声優インサイト */}
      {(() => {
        const vi = vaInsight(vas);
        return vi ? <AutoInsight lines={[vi]} /> : null;
      })()}

      {/* 比較バー（1名以上選択時） */}
      {compareNames.length >= 1 && (
        <div className="rounded-lg border border-line bg-surface px-4 py-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
          <span className="font-bold text-ink-soft text-xs shrink-0">比較中:</span>
          <span className="font-bold text-ink">{compareNames.join(" vs ")}</span>
          <Link
            href={buildClearHref(baseSp)}
            className="ml-auto text-xs text-muted hover:text-ink transition shrink-0"
          >
            クリア
          </Link>
        </div>
      )}

      {/* 声優比較パネル（2名以上） */}
      {compareNames.length >= 2 && (
        <TalentComparePanel
          compareNames={compareNames}
          vas={vas}
          baseSp={baseSp}
        />
      )}

      {/* 声優スコアカード */}
      <section className="card p-5 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-3 mb-1">
          <h2 className="section-title text-lg">声優スコアカード</h2>
          {vas.length > 0 && (
            <CsvExportButton
              filename="声優スコアカード"
              headers={["順位", "声優", "出演", "主演率%", "主演作平均", "打率", "モメンタム", "ブレイク"]}
              rows={vas.map((v, i) => [
                i + 1,
                v.name,
                v.appearances,
                Math.round(v.leadRatio * 100),
                v.leadAvgScore,
                formatBa(v.battingAverage),
                v.momentum,
                v.breakout ? "★" : "",
              ])}
            />
          )}
        </div>
        <p className="text-xs text-muted mb-1">
          主演作の平均スコア順（ノイズ除去のためスコア付き出演3本以上が対象）。注目度の高い声優を上位に表示。
        </p>
        <p className="text-[0.68rem] text-muted mb-4 leading-relaxed">
          主演＝キャスト表の上位（sort上位）を主演級とみなした近似。打率＝出演作が同クールのスコア中央値以上だった割合。
          モメンタム＝直近2年と通算の平均スコア差（▲上昇／▽下降）。★＝直近1年に主演作が当該クール上位10%入り（ブレイク）。
          スコアはAniList優先、なければMAL換算。
        </p>
        {vas.length === 0 ? (
          <p className="text-sm text-muted">スコアデータが十分に集まっていません。</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm border-collapse">
              <thead>
                <tr className="text-xs text-muted border-b border-line">
                  <th className="text-left font-bold py-2 pr-2 w-6">#</th>
                  <th className="text-left font-bold py-2 pr-3">声優</th>
                  <th className="text-center font-bold py-2 px-1 w-12">出演</th>
                  <th className="text-center font-bold py-2 px-1 w-14">主演率</th>
                  <th className="text-center font-bold py-2 px-1 w-20">主演作平均</th>
                  <th className="text-center font-bold py-2 px-1 w-14">打率</th>
                  <th className="text-center font-bold py-2 px-1 w-20">モメンタム</th>
                  <th className="text-center font-bold py-2 pl-3 w-12">注目</th>
                  <th className="text-center font-bold py-2 pl-2 w-14">比較</th>
                </tr>
              </thead>
              <tbody>
                {vas.map((v, i) => (
                  <VaRow
                    key={v.name}
                    v={v}
                    rank={i + 1}
                    compareNames={compareNames}
                    compareHref={buildCompareHref(compareNames, v.name, baseSp)}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* スタッフ実績 */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {staffBuckets.map((bucket) => (
          <StaffBucketCard
            key={bucket.role}
            label={bucket.label}
            roleKey={bucket.role}
            people={bucket.people}
            staffCompareNames={bucket.role === staffRoleKey ? staffCompareNames : []}
            comparestaff={comparestaff}
            baseSp={baseSp}
          />
        ))}
      </div>

      {/* スタッフ比較パネル */}
      {staffCompareNames.length >= 2 && (() => {
        const bucket = staffBuckets.find((b) => b.role === staffRoleKey);
        if (!bucket) return null;
        const selected = staffCompareNames
          .map((n) => bucket.people.find((p) => p.name === n))
          .filter((p): p is StaffScorecard => p != null);
        if (selected.length < 2) return null;
        const insight = compareStaffInsight(selected);
        return (
          <section className="card p-5 sm:p-6 border-accent/40">
            <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
              <h2 className="section-title text-lg">
                スタッフ比較 — {bucket.label}
              </h2>
              <Link
                href={buildClearStaffHref(baseSp)}
                className="text-xs text-muted hover:text-ink transition"
              >
                クリア
              </Link>
            </div>
            {insight && (
              <p className="text-sm text-ink-soft mb-3 leading-relaxed">{insight}</p>
            )}
            <StaffCompareTable people={selected} />
          </section>
        );
      })()}

      <p className="text-xs text-muted leading-relaxed">
        ※ スコアはAniList（無ければMAL換算）由来の参考値で、各サービス利用者を母数とした評価です。
        声優・スタッフの同定はクレジット表記のテキストに基づく近似であり、表記ゆれ等で精度に限界があります。
      </p>
    </div>
  );
}

/* ---------------------------------------------------------------- 声優比較パネル */

function TalentComparePanel({
  compareNames,
  vas,
  baseSp,
}: {
  compareNames: string[];
  vas: VaScorecard[];
  baseSp: string;
}) {
  const selected = compareNames.map((n) => ({
    name: n,
    card: vas.find((v) => v.name === n) ?? null,
  }));

  const found = selected
    .map((s) => s.card)
    .filter((c): c is VaScorecard => c != null);

  const insight = found.length >= 2 ? compareInsight(found) : null;

  // Best value per metric (index into selected)
  function bestIdx(getter: (c: VaScorecard) => number | null): number {
    let best = -1;
    let bestVal = -Infinity;
    selected.forEach((s, i) => {
      if (s.card == null) return;
      const v = getter(s.card);
      if (v != null && v > bestVal) {
        bestVal = v;
        best = i;
      }
    });
    return best;
  }

  const metrics: { label: string; getter: (c: VaScorecard) => number | null; fmt: (v: number) => string }[] = [
    { label: "出演作品数", getter: (c) => c.appearances, fmt: (v) => String(v) },
    { label: "主演率", getter: (c) => c.leadRatio, fmt: (v) => `${Math.round(v * 100)}%` },
    { label: "主演作平均スコア", getter: (c) => c.leadAvgScore, fmt: (v) => v.toFixed(1) },
    { label: "平均スコア", getter: (c) => c.avgScore, fmt: (v) => v.toFixed(1) },
    { label: "打率", getter: (c) => c.battingAverage, fmt: (v) => formatBa(v) },
    {
      label: "モメンタム",
      getter: (c) => c.momentum,
      fmt: (v) => (v >= 0 ? `+${v.toFixed(1)}` : v.toFixed(1)),
    },
    { label: "ブレイク", getter: (c) => (c.breakout ? 1 : 0), fmt: (v) => (v === 1 ? "★" : "—") },
  ];

  return (
    <section className="card p-5 sm:p-6 border-accent/40">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <h2 className="section-title text-lg">声優サイドバイサイド比較</h2>
        <Link
          href={buildClearHref(baseSp)}
          className="text-xs text-muted hover:text-ink transition"
        >
          クリア
        </Link>
      </div>
      {insight && (
        <p className="text-sm text-ink-soft mb-3 leading-relaxed">{insight}</p>
      )}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[480px] text-sm border-collapse">
          <thead>
            <tr className="border-b border-line">
              <th className="text-left font-bold py-2 pr-4 text-xs text-muted w-32">指標</th>
              {selected.map((s) => (
                <th key={s.name} className="text-center font-bold py-2 px-2 text-xs text-ink">
                  {s.name}
                  {s.card == null && (
                    <span className="block text-[0.62rem] font-normal text-muted">（圏外）</span>
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {metrics.map((m) => {
              const bi = bestIdx(m.getter);
              return (
                <tr key={m.label} className="border-b border-line/50">
                  <td className="py-2 pr-4 text-xs text-muted font-medium">{m.label}</td>
                  {selected.map((s, i) => {
                    if (s.card == null) {
                      return (
                        <td key={s.name} className="py-2 px-2 text-center text-xs text-muted">
                          —
                        </td>
                      );
                    }
                    const val = m.getter(s.card);
                    const isBest = i === bi && val != null;
                    return (
                      <td
                        key={s.name}
                        className={`py-2 px-2 text-center tabular-nums text-xs ${isBest ? "text-accent font-black" : "text-ink-soft font-medium"}`}
                      >
                        {val != null ? m.fmt(val) : "—"}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {selected.some((s) => s.card == null) && (
        <p className="text-[0.68rem] text-muted mt-2">
          ※「圏外」はスコア付き出演3本未満のためランキング対象外。
        </p>
      )}
    </section>
  );
}

/* ---------------------------------------------------------------- スタッフ比較テーブル（共通） */

function StaffCompareTable({ people }: { people: StaffScorecard[] }) {
  const metrics: { label: string; getter: (c: StaffScorecard) => number | null; fmt: (v: number) => string }[] = [
    { label: "作品数", getter: (c) => c.works, fmt: (v) => String(v) },
    { label: "平均スコア", getter: (c) => c.avgScore, fmt: (v) => v.toFixed(1) },
    { label: "一貫性", getter: (c) => c.consistency, fmt: (v) => String(v) },
    { label: "打率", getter: (c) => c.battingAverage, fmt: (v) => formatBa(v) },
  ];

  function bestIdx(getter: (c: StaffScorecard) => number | null): number {
    let best = -1;
    let bestVal = -Infinity;
    people.forEach((p, i) => {
      const v = getter(p);
      if (v != null && v > bestVal) {
        bestVal = v;
        best = i;
      }
    });
    return best;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[360px] text-sm border-collapse">
        <thead>
          <tr className="border-b border-line">
            <th className="text-left font-bold py-2 pr-4 text-xs text-muted w-28">指標</th>
            {people.map((p) => (
              <th key={p.name} className="text-center font-bold py-2 px-2 text-xs text-ink">
                {p.name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {metrics.map((m) => {
            const bi = bestIdx(m.getter);
            return (
              <tr key={m.label} className="border-b border-line/50">
                <td className="py-2 pr-4 text-xs text-muted font-medium">{m.label}</td>
                {people.map((p, i) => {
                  const val = m.getter(p);
                  const isBest = i === bi && val != null;
                  return (
                    <td
                      key={p.name}
                      className={`py-2 px-2 text-center tabular-nums text-xs ${isBest ? "text-accent font-black" : "text-ink-soft font-medium"}`}
                    >
                      {val != null ? m.fmt(val) : "—"}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function VaRow({
  v,
  rank,
  compareNames,
  compareHref,
}: {
  v: VaScorecard;
  rank: number;
  compareNames: string[];
  compareHref: string;
}) {
  const baStr = formatBa(v.battingAverage);
  const inCompare = compareNames.includes(v.name);
  return (
    <tr className={`border-b border-line/60 hover:bg-paper/60 ${inCompare ? "bg-surface" : ""}`}>
      <td className="py-2 pr-2 text-xs text-muted tabular-nums">{rank}</td>
      <td className="py-2 pr-3">
        <span className="font-medium text-ink line-clamp-1">{v.name}</span>
      </td>
      <td className="py-2 px-1 text-center tabular-nums text-xs text-ink-soft">{v.appearances}</td>
      <td className="py-2 px-1 text-center tabular-nums text-xs text-ink-soft">
        {Math.round(v.leadRatio * 100)}%
      </td>
      <td className="py-2 px-1 text-center tabular-nums font-black text-accent">
        {v.leadAvgScore != null ? Math.round(v.leadAvgScore) : "—"}
      </td>
      <td className="py-2 px-1 text-center tabular-nums text-xs font-bold text-ink">{baStr}</td>
      <td className="py-2 px-1 text-center">
        <MomentumTag value={v.momentum} />
      </td>
      <td className="py-2 pl-3 text-center">
        {v.breakout ? (
          <span className="text-accent font-black" title="ブレイク">
            ★
          </span>
        ) : (
          <span className="text-muted">—</span>
        )}
      </td>
      <td className="py-2 pl-2 text-center">
        <Link
          href={compareHref}
          className={`text-xs font-bold px-1.5 py-0.5 rounded transition ${
            inCompare
              ? "text-accent"
              : "text-muted hover:text-ink"
          }`}
          title={inCompare ? "比較から除外" : "比較に追加"}
        >
          {inCompare ? "✓" : "+比較"}
        </Link>
      </td>
    </tr>
  );
}

function MomentumTag({ value }: { value: number | null }) {
  if (value == null) return <span className="text-xs text-muted">—</span>;
  const rounded = Math.round(value * 10) / 10;
  if (rounded > 0) {
    return (
      <span className="text-xs font-bold tabular-nums text-emerald-600">
        ▲+{rounded.toFixed(1)}
      </span>
    );
  }
  if (rounded < 0) {
    return (
      <span className="text-xs font-bold tabular-nums text-rose-500">
        ▽{rounded.toFixed(1)}
      </span>
    );
  }
  return <span className="text-xs font-bold tabular-nums text-muted">±0.0</span>;
}

function StaffBucketCard({
  label,
  roleKey,
  people,
  staffCompareNames,
  comparestaff,
  baseSp,
}: {
  label: string;
  roleKey: string;
  people: StaffScorecard[];
  staffCompareNames: string[];
  comparestaff: string | undefined;
  baseSp: string;
}) {
  return (
    <section className="card p-5 sm:p-6">
      <h2 className="section-title text-base mb-3">{label}</h2>
      {people.length === 0 ? (
        <p className="text-sm text-muted">データがありません。</p>
      ) : (
        <>
          {staffCompareNames.length >= 1 && (
            <div className="mb-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
              <span className="text-muted font-bold">比較中:</span>
              <span className="text-ink font-bold">{staffCompareNames.join(" vs ")}</span>
              <Link
                href={buildClearStaffHref(baseSp)}
                className="text-muted hover:text-ink transition"
              >
                クリア
              </Link>
            </div>
          )}
          <div className="overflow-x-auto">
            <table className="w-full min-w-[320px] text-sm border-collapse">
              <thead>
                <tr className="text-[0.68rem] text-muted border-b border-line">
                  <th className="text-left font-bold py-1.5 pr-2">名前</th>
                  <th className="text-center font-bold py-1.5 px-1 w-10">作品</th>
                  <th className="text-center font-bold py-1.5 px-1 w-12">平均</th>
                  <th className="text-center font-bold py-1.5 px-1 w-12">一貫性</th>
                  <th className="text-center font-bold py-1.5 px-1 w-12">打率</th>
                  <th className="text-left font-bold py-1.5 pl-2 w-20">直近</th>
                  <th className="text-center font-bold py-1.5 pl-1 w-12">比較</th>
                </tr>
              </thead>
              <tbody>
                {people.map((p) => {
                  const conColor = consistencyColor(p.consistency);
                  const inCompare = staffCompareNames.includes(p.name);
                  const staffHref = buildStaffCompareHref(comparestaff, roleKey, p.name, baseSp);
                  return (
                    <tr
                      key={p.name}
                      className={`border-b border-line/60 hover:bg-paper/60 ${inCompare ? "bg-surface" : ""}`}
                    >
                      <td className="py-1.5 pr-2">
                        <span className="font-medium text-ink line-clamp-1 text-xs">{p.name}</span>
                      </td>
                      <td className="py-1.5 px-1 text-center tabular-nums text-xs text-ink-soft">
                        {p.works}
                      </td>
                      <td className="py-1.5 px-1 text-center tabular-nums font-black text-accent text-xs">
                        {Math.round(p.avgScore)}
                      </td>
                      <td
                        className={`py-1.5 px-1 text-center tabular-nums font-bold text-xs ${conColor}`}
                      >
                        {p.consistency != null ? p.consistency : "—"}
                      </td>
                      <td className="py-1.5 px-1 text-center tabular-nums text-xs font-bold text-ink">
                        {formatBa(p.battingAverage)}
                      </td>
                      <td className="py-1.5 pl-2">
                        <ScoreSparkline data={p.yearTrend} />
                      </td>
                      <td className="py-1.5 pl-1 text-center">
                        <Link
                          href={staffHref}
                          className={`text-xs font-bold px-1 py-0.5 rounded transition ${
                            inCompare ? "text-accent" : "text-muted hover:text-ink"
                          }`}
                          title={inCompare ? "比較から除外" : "比較に追加"}
                        >
                          {inCompare ? "✓" : "+比較"}
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}

/* ================================================================ 収集状況 */

async function CollectionSection() {
  const [coverage, jobs, gaps] = await Promise.all([
    getCoverageStats().catch(() => ({
      total: 0,
      collected: 0,
      noComments: 0,
      error: 0,
      pending: 0,
      collectedPct: 0,
    })),
    getRecentJobs(12).catch(() => [] as CollectionJob[]),
    getCollectionGaps(30).catch(() => [] as CollectionGap[]),
  ]);

  const segments = [
    { key: "collected", label: "収集済み", value: coverage.collected, color: "#2ebd85" },
    { key: "no_comments", label: "0件/未取得", value: coverage.noComments, color: "#f5a623" },
    { key: "error", label: "エラー", value: coverage.error, color: "#e8482f" },
    { key: "pending", label: "未収集", value: coverage.pending, color: "#c3c8d2" },
  ];
  const total = coverage.total;

  return (
    <div className="space-y-5">
      {/* 収集カバレッジ */}
      <section className="card p-5 sm:p-6">
        <h2 className="section-title text-lg mb-1">直近の収集カバレッジ（過去7日）</h2>
        <p className="text-xs text-muted mb-4">
          実況チャンネルのある本放送（放送終了が45分前〜7日前）のうち、ニコニコ実況コメントをどれだけ収集できているか。
          母数は実況チャンネル（jikkyo_id）を持つ番組のみ。
        </p>
        {total === 0 ? (
          <p className="text-sm text-muted">対象番組がまだありません。</p>
        ) : (
          <>
            <div className="flex items-baseline gap-3 mb-3">
              <span className="text-3xl font-black text-accent tabular-nums">{coverage.collectedPct}%</span>
              <span className="text-xs text-muted tabular-nums">
                収集済み {coverage.collected.toLocaleString()} / {total.toLocaleString()} 番組
              </span>
            </div>
            {/* 内訳バー */}
            <div className="flex h-4 w-full overflow-hidden rounded-full bg-paper">
              {segments.map((s) =>
                s.value > 0 ? (
                  <div
                    key={s.key}
                    style={{ width: `${(s.value / total) * 100}%`, backgroundColor: s.color }}
                    title={`${s.label}: ${s.value}`}
                  />
                ) : null,
              )}
            </div>
            <div className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-2">
              {segments.map((s) => (
                <div key={s.key} className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-[2px] shrink-0" style={{ backgroundColor: s.color }} />
                  <span className="text-xs text-ink-soft">{s.label}</span>
                  <span className="text-xs font-bold text-ink tabular-nums ml-auto">{s.value.toLocaleString()}</span>
                </div>
              ))}
            </div>
          </>
        )}
      </section>

      {/* 収集ジョブ履歴 */}
      <section className="card p-5 sm:p-6">
        <h2 className="section-title text-lg mb-1">直近の収集ジョブ</h2>
        <p className="text-xs text-muted mb-4">
          毎時実行される収集処理（collect-jikkyo）の履歴。コンスタントに動いていれば取りこぼしは自動で埋まっていきます。
        </p>
        {jobs.length === 0 ? (
          <p className="text-sm text-muted">ジョブ履歴がまだありません。</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] text-sm border-collapse">
              <thead>
                <tr className="text-xs text-muted border-b border-line">
                  <th className="text-left font-bold py-2 pr-3">実行時刻</th>
                  <th className="text-center font-bold py-2 px-1 w-16">状態</th>
                  <th className="text-center font-bold py-2 px-1 w-16">収集</th>
                  <th className="text-center font-bold py-2 px-1 w-20">0件/未取得</th>
                  <th className="text-center font-bold py-2 px-1 w-14">エラー</th>
                </tr>
              </thead>
              <tbody>
                {jobs.map((j) => (
                  <tr key={j.id} className="border-b border-line/60 hover:bg-paper/60">
                    <td className="py-2 pr-3 text-xs text-ink-soft tabular-nums whitespace-nowrap">
                      {j.finishedAt ? formatAirShort(j.finishedAt) : j.startedAt ? formatAirShort(j.startedAt) : "—"}
                    </td>
                    <td className="py-2 px-1 text-center">
                      <span
                        className={`inline-block text-[0.66rem] font-bold px-2 py-0.5 rounded-full whitespace-nowrap ${
                          j.status === "ok"
                            ? "bg-emerald-100 text-emerald-700"
                            : j.status === "partial"
                              ? "bg-amber-100 text-amber-700"
                              : "bg-paper text-muted border border-line"
                        }`}
                      >
                        {j.status ?? "—"}
                      </span>
                    </td>
                    <td className="py-2 px-1 text-center tabular-nums font-bold text-ink">
                      {j.collected.toLocaleString()}
                    </td>
                    <td className="py-2 px-1 text-center tabular-nums text-xs text-ink-soft">
                      {j.noComments.toLocaleString()}
                    </td>
                    <td
                      className={`py-2 px-1 text-center tabular-nums text-xs font-bold ${
                        j.errors > 0 ? "text-accent" : "text-muted"
                      }`}
                    >
                      {j.errors.toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* 取りこぼし一覧 */}
      <section className="card p-5 sm:p-6">
        <h2 className="section-title text-lg mb-1">取りこぼし一覧（直近7日）</h2>
        <p className="text-xs text-muted mb-1">
          収集すべきだがまだコメントを取得できていない番組（エラー / 0件・未取得 / 未収集）。新しい順に最大30件。
        </p>
        <p className="text-[0.68rem] text-muted mb-4 leading-relaxed">
          これらは放送終了から48時間以内なら毎時の収集で自動リトライされます（過去ログAPIへの反映待ちの可能性）。
          「0件・未取得」は本当にコメントが無かった回も含まれるため、必ずしもエラーではありません。
          急ぐ場合は cron-jikkyo ワークフローを lookback_hours / retry_failed 付きで手動実行すると即時バックフィルできます。
        </p>
        {gaps.length === 0 ? (
          <p className="text-sm text-muted">取りこぼしはありません。すべて収集済みです。</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[600px] text-sm border-collapse">
              <thead>
                <tr className="text-xs text-muted border-b border-line">
                  <th className="text-left font-bold py-2 pr-3">作品 / 話数</th>
                  <th className="text-left font-bold py-2 px-2 w-28">チャンネル</th>
                  <th className="text-left font-bold py-2 px-2 w-36">放送開始</th>
                  <th className="text-center font-bold py-2 pl-2 w-24">状態</th>
                </tr>
              </thead>
              <tbody>
                {gaps.map((g) => (
                  <tr key={g.programId} className="border-b border-line/60 hover:bg-paper/60">
                    <td className="py-2 pr-3">
                      <span className="font-medium text-ink line-clamp-1">
                        {g.workTitle}
                        {g.episodeLabel && <span className="font-normal text-ink-soft ml-1.5">{g.episodeLabel}</span>}
                      </span>
                    </td>
                    <td className="py-2 px-2 text-xs text-ink-soft truncate">{g.channelName ?? "—"}</td>
                    <td className="py-2 px-2 text-xs text-ink-soft tabular-nums whitespace-nowrap">
                      {formatAirShort(g.startAt)}
                    </td>
                    <td className="py-2 pl-2 text-center">
                      <GapStatusTag status={g.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <p className="text-xs text-muted leading-relaxed">
        ※ 収集は個人運営の過去ログAPIへ配慮し、1番組ずつ間隔を空けて取得しています。
        放送直後はAPIへの反映に時間がかかるため、45分のバッファを置いてから収集を開始します。
      </p>
    </div>
  );
}

function GapStatusTag({ status }: { status: CollectionGap["status"] }) {
  const map: Record<CollectionGap["status"], { label: string; cls: string }> = {
    error: { label: "エラー", cls: "bg-rose-100 text-rose-700" },
    no_comments: { label: "0件/未取得", cls: "bg-amber-100 text-amber-700" },
    pending: { label: "未収集", cls: "bg-paper text-muted border border-line" },
  };
  const { label, cls } = map[status];
  return (
    <span className={`inline-block text-[0.66rem] font-bold px-2 py-0.5 rounded-full whitespace-nowrap ${cls}`}>
      {label}
    </span>
  );
}

/* ================================================================ 業界データ */

async function IndustrySection({ period }: { period?: string }) {
  const curYear = new Date().getFullYear();
  const { filter, label, key } = parsePeriod(period, curYear);

  const [volumeAll, scorecards, vas, popular, topAni, topMal, genreInsights, franchises] = await Promise.all([
    getSeasonVolume().catch((): SeasonVolume[] => []),
    getStudioScorecards({ limit: 20 }).catch((): StudioScorecard[] => []),
    getVaRanking(filter, 24).catch((): VaStat[] => []),
    getPopular(filter, 12).catch((): RatedWork[] => []),
    getTopRated(filter, "anilist", 12).catch((): RatedWork[] => []),
    getTopRated(filter, "mal", 12).catch((): RatedWork[] => []),
    getGenreInsights().catch(() => [] as GenreInsight[]),
    getFranchiseMomentum().catch(() => [] as FranchiseGroup[]),
  ]);

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

      {/* スタジオ・スコアカード */}
      {(() => {
        const si = studioInsight(scorecards);
        return si ? <AutoInsight lines={[si]} /> : null;
      })()}
      <StudioScorecardCard scorecards={scorecards} />

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

      {/* ジャンル動向 */}
      {(() => {
        const go = genreOpportunity(genreInsights);
        return go ? <AutoInsight lines={[go]} /> : null;
      })()}
      <GenreTrendsCard insights={genreInsights} />

      {/* ジャンル機会マップ（飽和×需要） */}
      <GenreOpportunityMapCard insights={genreInsights} />

      {/* IP・続編モメンタム */}
      {franchises.length > 0 && (() => {
        const fi = franchiseInsight(franchises);
        return (
          <>
            {fi && <AutoInsight lines={[fi]} />}
            <FranchiseMomentumCard groups={franchises} />
          </>
        );
      })()}

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

/* ================================================================ スタジオ・スコアカード */

/** 打率の小数表記 .XXX */
function formatBa(ba: number): string {
  return `.${String(Math.round(ba * 1000)).padStart(3, "0")}`;
}

/** 一貫性スコアの色 */
function consistencyColor(v: number | null): string {
  if (v == null) return "text-muted";
  if (v >= 70) return "text-accent";
  if (v >= 50) return "text-ink";
  return "text-muted";
}

/** インラインSVGスパークライン（yearTrend 用, ~80×24px） */
function ScoreSparkline({ data }: { data: { year: number; avgScore: number }[] }) {
  if (data.length < 2) {
    return (
      <span className="text-[0.65rem] text-muted tabular-nums">
        {data.length === 1 ? data[0].avgScore.toFixed(0) : "—"}
      </span>
    );
  }
  const W = 80;
  const H = 24;
  const PAD = 3;
  const scores = data.map((d) => d.avgScore);
  const minS = Math.min(...scores);
  const maxS = Math.max(...scores);
  const range = maxS - minS || 1; // avoid divide-by-zero when all equal
  const px = (i: number) => PAD + (i / (data.length - 1)) * (W - PAD * 2);
  const py = (s: number) => PAD + (1 - (s - minS) / range) * (H - PAD * 2);
  const points = data.map((d, i) => `${px(i).toFixed(1)},${py(d.avgScore).toFixed(1)}`).join(" ");

  return (
    <svg
      width={W}
      height={H}
      viewBox={`0 0 ${W} ${H}`}
      aria-hidden="true"
      className="overflow-visible"
    >
      <polyline
        points={points}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
        strokeLinecap="round"
        className="text-muted"
      />
      {/* last point dot */}
      <circle
        cx={px(data.length - 1).toFixed(1)}
        cy={py(scores[scores.length - 1]).toFixed(1)}
        r="2"
        className="fill-current text-muted"
      />
    </svg>
  );
}

function StudioScorecardCard({ scorecards }: { scorecards: StudioScorecard[] }) {
  return (
    <section className="card p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3 mb-1">
        <h2 className="section-title text-lg">スタジオ・スコアカード</h2>
        {scorecards.length > 0 && (
          <CsvExportButton
            filename="スタジオスコアカード"
            headers={["順位", "制作会社", "制作数", "スコア付き作品数", "平均スコア", "打率", "一貫性"]}
            rows={scorecards.map((sc, i) => [
              i + 1,
              sc.studio,
              sc.worksCount,
              sc.scoredWorks,
              sc.avgScore,
              formatBa(sc.battingAverage),
              sc.consistency,
            ])}
          />
        )}
      </div>
      <p className="text-xs text-muted mb-1">
        平均スコア順（ノイズ除去のためスコア付き作品3本以上が対象）。スコアはAniList優先、なければMAL換算。
      </p>
      <p className="text-[0.68rem] text-muted mb-4 leading-relaxed">
        打率＝各作品が「同クールのスコア中央値」以上だった割合。一貫性＝スコアのばらつきの小ささ。スコアはAniList(無ければMAL)。
      </p>
      {scorecards.length === 0 ? (
        <p className="text-sm text-muted">スコアデータが十分に集まっていません。</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm border-collapse">
            <thead>
              <tr className="text-xs text-muted border-b border-line">
                <th className="text-left font-bold py-2 pr-2 w-6">#</th>
                <th className="text-left font-bold py-2 pr-3">制作会社</th>
                <th className="text-center font-bold py-2 px-1 w-14">制作数</th>
                <th className="text-center font-bold py-2 px-1 w-16">平均スコア</th>
                <th className="text-left font-bold py-2 px-2 w-32">打率</th>
                <th className="text-center font-bold py-2 px-1 w-14">一貫性</th>
                <th className="text-left font-bold py-2 pl-3 w-24">直近トレンド</th>
              </tr>
            </thead>
            <tbody>
              {scorecards.map((sc, i) => {
                const baStr = formatBa(sc.battingAverage);
                const baPct = Math.round(sc.battingAverage * 100);
                const conColor = consistencyColor(sc.consistency);
                return (
                  <tr key={sc.studio} className="border-b border-line/60 hover:bg-paper/60">
                    <td className="py-2 pr-2 text-xs text-muted tabular-nums">{i + 1}</td>
                    <td className="py-2 pr-3">
                      <Link
                        href={`/analytics/studios/${encodeURIComponent(sc.studio)}`}
                        className="font-medium text-ink hover:text-primary transition line-clamp-1"
                      >
                        {sc.studio}
                      </Link>
                    </td>
                    {/* 制作数 */}
                    <td className="py-2 px-1 text-center tabular-nums text-xs text-ink-soft">
                      {sc.worksCount}
                    </td>
                    {/* 平均スコア */}
                    <td className="py-2 px-1 text-center tabular-nums font-black text-accent">
                      {Math.round(sc.avgScore)}
                    </td>
                    {/* 打率 + ミニバー */}
                    <td className="py-2 px-2">
                      <div className="flex items-center gap-1.5">
                        <span className="tabular-nums text-xs font-bold text-ink w-10 shrink-0">
                          {baStr}
                        </span>
                        <div className="flex-1 min-w-0 bg-paper rounded-full h-2">
                          <div
                            className="h-2 rounded-full bg-primary/70"
                            style={{ width: `${Math.max(2, baPct)}%` }}
                          />
                        </div>
                      </div>
                    </td>
                    {/* 一貫性 */}
                    <td className={`py-2 px-1 text-center tabular-nums font-bold text-xs ${conColor}`}>
                      {sc.consistency != null ? sc.consistency : "—"}
                    </td>
                    {/* 直近トレンド */}
                    <td className="py-2 pl-3">
                      <ScoreSparkline data={sc.yearTrend} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-[0.68rem] text-muted mt-3 leading-relaxed">
        ※ スコアはAniList/MAL由来・各サービス利用者を母数とした参考値です。テレビ視聴率ではありません。
      </p>
    </section>
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

/* ================================================================ ジャンル動向 */

function GenreTrendsCard({ insights }: { insights: GenreInsight[] }) {
  const top = insights.slice(0, 24);
  return (
    <section className="card p-5 sm:p-6">
      <h2 className="section-title text-lg mb-1">ジャンル動向</h2>
      <p className="text-xs text-muted mb-4">
        AniList ジャンルタグ別の作品数・平均人気・平均スコア（上位24ジャンル）。
        スコアは AniList 優先、なければ MAL 換算。データは12時間ごとに補完されます。
      </p>
      {top.length === 0 ? (
        <p className="text-sm text-muted">
          ジャンルデータはまだ補完されていません。enrich-scores スクリプト実行後に表示されます。
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[480px] text-sm border-collapse">
            <thead>
              <tr className="text-xs text-muted border-b border-line">
                <th className="text-left font-bold py-2 pr-3">ジャンル</th>
                <th className="text-center font-bold py-2 px-2 w-16">作品数</th>
                <th className="text-center font-bold py-2 px-2 w-24">平均人気</th>
                <th className="text-center font-bold py-2 px-2 w-20">平均スコア</th>
              </tr>
            </thead>
            <tbody>
              {top.map((g) => (
                <tr key={g.genre} className="border-b border-line/60 hover:bg-paper/60">
                  <td className="py-2 pr-3 font-medium text-ink">{g.genre}</td>
                  <td className="py-2 px-2 text-center tabular-nums text-xs text-ink-soft">
                    {g.worksCount.toLocaleString()}
                  </td>
                  <td className="py-2 px-2 text-center tabular-nums text-xs text-ink-soft">
                    {g.avgPopularity.toLocaleString()}
                  </td>
                  <td className="py-2 px-2 text-center tabular-nums font-bold text-accent">
                    {g.avgScore != null ? g.avgScore.toFixed(1) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-[0.68rem] text-muted mt-3 leading-relaxed">
        ※ スコアはAniList/MAL由来・各サービス利用者を母数とした参考値です。テレビ視聴率ではありません。
      </p>
    </section>
  );
}

/* ================================================================ ジャンル機会マップ */

/**
 * ジャンル機会マップ（飽和×需要）。
 * x=作品数（飽和度）, y=平均人気（需要）を各々パーセンタイル順位(0-100)へ正規化した
 * インラインSVG散布図。サーバーコンポーネント（router不要・ホバーなし、title属性でツールチップ）。
 */
function GenreOpportunityMapCard({ insights }: { insights: GenreInsight[] }) {
  const eligible = insights.filter((g) => g.worksCount >= 2 && g.avgPopularity > 0);

  if (eligible.length < 4) {
    return null;
  }

  const counts = eligible.map((g) => g.worksCount);
  const pops = eligible.map((g) => g.avgPopularity);

  // 各ジャンルを (供給percentile, 需要percentile) に正規化
  const pts = eligible.map((g) => {
    const supply = toPercentileRank(counts, g.worksCount); // x: 飽和度
    const demand = toPercentileRank(pops, g.avgPopularity); // y: 需要
    return { g, supply, demand, opportunity: demand - supply };
  });

  const top5 = [...pts].sort((a, b) => b.opportunity - a.opportunity).slice(0, 5);

  // SVG レイアウト（QuadrantScatter を踏襲した寸法・配色）
  const W = 720;
  const H = 520;
  const PAD = { top: 28, right: 24, bottom: 44, left: 48 };
  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;
  const sx = (v: number) => PAD.left + (v / 100) * innerW;
  const sy = (v: number) => PAD.top + (1 - v / 100) * innerH;

  const quads = [
    { label: "機会（需要高×供給少）", cx: 0.25, cy: 0.25, color: "#2ebd85" },
    { label: "激戦区", cx: 0.75, cy: 0.25, color: "#e8482f" },
    { label: "ニッチ", cx: 0.25, cy: 0.75, color: "#9b59b6" },
    { label: "供給過多", cx: 0.75, cy: 0.75, color: "#f5a623" },
  ];

  return (
    <section className="card p-5 sm:p-6">
      <h2 className="section-title text-lg mb-1">ジャンル機会マップ（飽和×需要）</h2>
      <p className="text-xs text-muted mb-4">
        横＝作品数（飽和度）、縦＝平均人気（需要）。どちらも全ジャンル内のパーセンタイル順位。
        左上＝機会（需要高×供給少・greenlight候補）、右上＝激戦区、左下＝ニッチ、右下＝供給過多。
        対象は作品数2本以上のジャンル。
      </p>

      <div className="overflow-x-auto">
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full min-w-[560px]" role="img" aria-label="ジャンルの飽和×需要マップ">
          {/* 象限の背景ラベル */}
          {quads.map((q) => (
            <text
              key={q.label}
              x={PAD.left + q.cx * innerW}
              y={PAD.top + q.cy * innerH}
              textAnchor="middle"
              fontSize="13"
              fontWeight="bold"
              fill={q.color}
              opacity={0.28}
            >
              {q.label}
            </text>
          ))}

          {/* 基準線（50パーセンタイル） */}
          <line x1={sx(50)} x2={sx(50)} y1={PAD.top} y2={H - PAD.bottom} stroke="#9aa3b2" strokeDasharray="4 4" />
          <line x1={PAD.left} x2={W - PAD.right} y1={sy(50)} y2={sy(50)} stroke="#9aa3b2" strokeDasharray="4 4" />

          {/* 枠 */}
          <rect x={PAD.left} y={PAD.top} width={innerW} height={innerH} fill="none" stroke="#e8eaef" />

          {/* 軸ラベル */}
          <text x={W / 2} y={H - 10} textAnchor="middle" fontSize="11" fill="#8a909c">
            作品数（飽和度・パーセンタイル）→ 供給が多い
          </text>
          <text
            x={14}
            y={H / 2}
            textAnchor="middle"
            fontSize="11"
            fill="#8a909c"
            transform={`rotate(-90 14 ${H / 2})`}
          >
            平均人気（需要・パーセンタイル）→ 需要が高い
          </text>

          {/* 点 */}
          {pts.map((p) => {
            const cx = sx(p.supply);
            const cy = sy(p.demand);
            const isOpp = p.demand >= 50 && p.supply < 50;
            return (
              <g key={p.g.genre}>
                <circle
                  cx={cx}
                  cy={cy}
                  r={5}
                  fill={isOpp ? "#2ebd85" : "#2f6fdb"}
                  fillOpacity={0.55}
                  stroke={isOpp ? "#2ebd85" : "#2f6fdb"}
                  strokeWidth={1}
                >
                  <title>
                    {`${p.g.genre}: 需要${p.demand} / 供給${p.supply}（平均人気${p.g.avgPopularity.toLocaleString()}・${p.g.worksCount}本）`}
                  </title>
                </circle>
                <text x={cx + 7} y={cy + 3} fontSize="10" fill="#5a616e">
                  {p.g.genre}
                </text>
              </g>
            );
          })}
        </svg>
      </div>

      {/* 機会ジャンル TOP5 */}
      <div className="mt-5">
        <h3 className="font-black text-[0.92rem] text-emerald-600 mb-1">機会ジャンル TOP5</h3>
        <p className="text-[0.68rem] text-muted mb-3 leading-relaxed">
          需要パーセンタイル − 供給パーセンタイルが大きい順＝需要の割に供給が薄いジャンル。
        </p>
        <ol className="divide-y divide-line">
          {top5.map((p, i) => (
            <li key={p.g.genre} className="flex items-center gap-3 py-2">
              <span className={`w-5 text-right font-black tabular-nums shrink-0 ${i < 3 ? "text-accent" : "text-muted"}`}>
                {i + 1}
              </span>
              <span className="flex-1 min-w-0 text-sm font-medium text-ink truncate">{p.g.genre}</span>
              <span className="text-xs text-muted tabular-nums shrink-0 whitespace-nowrap">
                平均人気{p.g.avgPopularity.toLocaleString()} / {p.g.worksCount}本 / スコア
                {p.g.avgScore != null ? p.g.avgScore.toFixed(1) : "—"}
              </span>
              <span className="text-xs font-black text-emerald-600 tabular-nums shrink-0 w-12 text-right">
                +{p.opportunity}
              </span>
            </li>
          ))}
        </ol>
      </div>

      <p className="text-[0.68rem] text-muted mt-3 leading-relaxed">
        ※ 需要＝Annict平均ウォッチャー数・供給＝登録作品数による近似。
      </p>
    </section>
  );
}

/* ================================================================ IP・続編モメンタム */

/** verdict → 矢印記号と色クラス。 */
const VERDICT_STYLE: Record<string, { arrow: string; cls: string; label: string }> = {
  growing: { arrow: "▲", cls: "text-emerald-600", label: "拡大" },
  stable: { arrow: "→", cls: "text-muted", label: "横ばい" },
  decaying: { arrow: "▼", cls: "text-rose-600", label: "縮小" },
};

/** 人気推移のインラインSVGスパークライン（series を正規化して描画, ~70×22px）。 */
function PopularitySparkline({ values }: { values: number[] }) {
  if (values.length < 2) {
    return <span className="text-[0.65rem] text-muted tabular-nums">—</span>;
  }
  const W = 70;
  const H = 22;
  const PAD = 3;
  const minV = Math.min(...values);
  const maxV = Math.max(...values);
  const range = maxV - minV || 1; // 全て同値のとき divide-by-zero 回避
  const px = (i: number) => PAD + (i / (values.length - 1)) * (W - PAD * 2);
  const py = (v: number) => PAD + (1 - (v - minV) / range) * (H - PAD * 2);
  const points = values.map((v, i) => `${px(i).toFixed(1)},${py(v).toFixed(1)}`).join(" ");

  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} aria-hidden="true" className="overflow-visible">
      <polyline
        points={points}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
        strokeLinecap="round"
        className="text-ink-soft"
      />
      <circle
        cx={px(values.length - 1).toFixed(1)}
        cy={py(values[values.length - 1]).toFixed(1)}
        r="2"
        className="fill-current text-ink-soft"
      />
    </svg>
  );
}

function FranchiseMomentumCard({ groups }: { groups: FranchiseGroup[] }) {
  return (
    <section className="card p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3 mb-1">
        <h2 className="section-title text-lg">IP・続編モメンタム</h2>
        <CsvExportButton
          filename="IP続編モメンタム"
          headers={["IP", "作品数", "初期人気", "最新人気", "人気推移(倍)", "スコア推移", "判定"]}
          rows={groups.map((g) => [
            g.latestTitle,
            g.entriesCount,
            g.entries[0]?.popularity ?? 0,
            g.latestPopularity,
            g.popularityTrend ?? "",
            g.scoreTrend ?? "",
            g.verdict ?? "",
          ])}
        />
      </div>
      <p className="text-xs text-muted mb-1">
        続編・シリーズの「シーズン越え」での人気の伸び/縮みを可視化（拡大IP優先・上位24系列）。続編greenlight・フランチャイズ投資の材料。
      </p>
      <p className="text-[0.68rem] text-muted mb-4 leading-relaxed">
        ※ 同名タイトルの語幹マッチによる近似グルーピング（公式のシリーズ情報ではない）。人気はAnnictウォッチャー数。
      </p>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[600px] text-sm border-collapse">
          <thead>
            <tr className="text-xs text-muted border-b border-line">
              <th className="text-left font-bold py-2 pr-3">IP（最新作）</th>
              <th className="text-center font-bold py-2 px-2 w-14">作品数</th>
              <th className="text-left font-bold py-2 px-2 w-40">人気推移</th>
              <th className="text-center font-bold py-2 px-2 w-20">スコア推移</th>
              <th className="text-left font-bold py-2 pl-3 w-20">推移</th>
            </tr>
          </thead>
          <tbody>
            {groups.map((g) => {
              const vs = g.verdict ? VERDICT_STYLE[g.verdict] : null;
              const first = g.entries[0];
              const trendStr =
                g.popularityTrend != null ? `${g.popularityTrend.toFixed(2)}倍` : "—";
              const scoreStr =
                g.scoreTrend == null
                  ? "—"
                  : g.scoreTrend > 0
                    ? `+${g.scoreTrend}`
                    : `${g.scoreTrend}`;
              return (
                <tr key={g.stem} className="border-b border-line/60 hover:bg-paper/60">
                  <td className="py-2 pr-3">
                    <Link
                      href={`/analytics/works/${g.latestWorkId}`}
                      className="flex items-center gap-2.5 group"
                    >
                      <WorkCover
                        id={g.latestWorkId}
                        title={g.latestTitle}
                        url={g.posterUrl}
                        className="w-8 h-11 rounded shrink-0"
                      />
                      <span className="font-medium text-ink group-hover:text-accent line-clamp-2">
                        {g.latestTitle}
                      </span>
                    </Link>
                  </td>
                  <td className="py-2 px-2 text-center tabular-nums text-xs text-ink-soft">
                    {g.entriesCount}
                  </td>
                  <td className="py-2 px-2">
                    <div className="flex items-center gap-2">
                      <span className="text-[0.65rem] tabular-nums text-muted shrink-0">
                        {(first?.popularity ?? 0).toLocaleString()}
                        <span className="mx-1">→</span>
                        {g.latestPopularity.toLocaleString()}
                      </span>
                      <span className={`shrink-0 ${vs?.cls ?? "text-muted"}`}>
                        <PopularitySparkline values={g.entries.map((e) => e.popularity)} />
                      </span>
                    </div>
                    <span className={`text-[0.62rem] tabular-nums ${vs?.cls ?? "text-muted"}`}>
                      {vs?.arrow ?? ""} {trendStr}
                    </span>
                  </td>
                  <td
                    className={`py-2 px-2 text-center tabular-nums font-bold ${
                      g.scoreTrend == null
                        ? "text-muted"
                        : g.scoreTrend > 0
                          ? "text-emerald-600"
                          : g.scoreTrend < 0
                            ? "text-rose-600"
                            : "text-muted"
                    }`}
                  >
                    {scoreStr}
                  </td>
                  <td className={`py-2 pl-3 text-xs font-bold ${vs?.cls ?? "text-muted"}`}>
                    {vs ? `${vs.arrow} ${vs.label}` : "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
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
