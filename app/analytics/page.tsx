export const dynamic = "force-dynamic";
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
import { seasonSummary, studioInsight, vaInsight, genreOpportunity } from "@/lib/analytics/insights";
import { AutoInsight } from "@/components/AutoInsight";
import { RetentionChart } from "@/components/charts/RetentionChart";
import { HotProgramsPanel } from "@/components/charts/HotProgramsPanel";
import { QuadrantScatter } from "@/components/charts/QuadrantScatter";
import { SEASON_LABELS, SEASON_ORDER } from "@/lib/season";
import { formatPopularity } from "@/lib/format";
import { WorkCover } from "@/components/WorkCover";
import { CsvExportButton } from "@/components/CsvExportButton";
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
  searchParams: Promise<{ view?: string; period?: string; basis?: string }>;
}) {
  const sp = await searchParams;
  const view =
    sp.view === "industry"
      ? "industry"
      : sp.view === "scorecard"
        ? "scorecard"
        : sp.view === "people"
          ? "people"
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
            { key: "industry", href: "/analytics?view=industry", label: "業界データ" },
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
        <PeopleSection />
      ) : (
        <IndustrySection period={sp.period} />
      )}

      <div className="h-16" />
    </div>
  );
}

/* ================================================================ 視聴分析 */

async function ViewingSection({ basis }: { basis: "jikkyo" | "annict" }) {
  const [retention, hot, peaks, ratios] = await Promise.all([
    basis === "annict"
      ? getRetentionSeries(8).catch(() => ({ snapshotDate: null, series: [] }))
      : getJikkyoRetentionSeries(8).catch(() => ({ snapshotDate: null, series: [] })),
    getHotPrograms(6, 14).catch(() => []),
    getPeakMoments(10).catch(() => []),
    getReactionRatios(1000).catch(() => []),
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

      <p className="text-xs text-muted leading-relaxed">
        ※ データソース: Annict（記録数）・ニコニコ実況 過去ログAPI（コメント）。
        どちらも各サービスの利用者を母数とした参考値であり、テレビの視聴率・視聴者数を示すものではありません。
      </p>
    </div>
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

  // スリーパー（過小評価）/ 話題先行：スリーパーを先頭に
  const flagged = card.works
    .filter((w) => w.sleeper || w.overhyped)
    .sort((a, b) => Number(b.sleeper) - Number(a.sleeper));

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

      {/* スリーパー（過小評価）/ 話題先行 */}
      {flagged.length > 0 && (
        <section className="card p-5 sm:p-6">
          <h2 className="section-title text-lg mb-1">スリーパー（過小評価）/ 話題先行</h2>
          <p className="text-xs text-muted mb-4">
            <strong>過小評価</strong>＝評価は高いが認知が低い（発掘・先行投資の候補）。
            <strong>話題先行</strong>＝認知は高いが評価が伴わない。いずれも認知・評価の偏差値で判定しています。
          </p>
          <ol className="space-y-2">
            {flagged.map((w) => (
              <li key={w.workId} className="flex items-center gap-3">
                <Link
                  href={`/analytics/works/${w.workId}`}
                  className="flex-1 min-w-0 text-sm font-medium text-ink hover:text-primary transition truncate"
                >
                  {w.title}
                </Link>
                <span className="text-xs text-muted tabular-nums shrink-0">
                  認知{w.awarenessDev.toFixed(0)} / 評価{w.scoreDev != null ? w.scoreDev.toFixed(0) : "—"}
                </span>
                <span
                  className={`shrink-0 text-[0.66rem] font-bold px-2 py-0.5 rounded-full whitespace-nowrap ${
                    w.sleeper
                      ? "bg-amber-100 text-amber-700"
                      : "bg-paper text-muted border border-line"
                  }`}
                >
                  {w.sleeper ? "過小評価" : "話題先行"}
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

async function PeopleSection() {
  const [vas, staffBuckets] = await Promise.all([
    getVoiceActorScorecards({ limit: 30 }).catch(() => []),
    getStaffScorecards({ limit: 15 }).catch(() => []),
  ]);

  return (
    <div className="space-y-5">
      {/* 声優インサイト */}
      {(() => {
        const vi = vaInsight(vas);
        return vi ? <AutoInsight lines={[vi]} /> : null;
      })()}
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
            <table className="w-full min-w-[680px] text-sm border-collapse">
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
                </tr>
              </thead>
              <tbody>
                {vas.map((v, i) => (
                  <VaRow key={v.name} v={v} rank={i + 1} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* スタッフ実績 */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {staffBuckets.map((bucket) => (
          <StaffBucketCard key={bucket.role} label={bucket.label} people={bucket.people} />
        ))}
      </div>

      <p className="text-xs text-muted leading-relaxed">
        ※ スコアはAniList（無ければMAL換算）由来の参考値で、各サービス利用者を母数とした評価です。
        声優・スタッフの同定はクレジット表記のテキストに基づく近似であり、表記ゆれ等で精度に限界があります。
      </p>
    </div>
  );
}

function VaRow({ v, rank }: { v: VaScorecard; rank: number }) {
  const baStr = formatBa(v.battingAverage);
  return (
    <tr className="border-b border-line/60 hover:bg-paper/60">
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

function StaffBucketCard({ label, people }: { label: string; people: StaffScorecard[] }) {
  return (
    <section className="card p-5 sm:p-6">
      <h2 className="section-title text-base mb-3">{label}</h2>
      {people.length === 0 ? (
        <p className="text-sm text-muted">データがありません。</p>
      ) : (
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
              </tr>
            </thead>
            <tbody>
              {people.map((p) => {
                const conColor = consistencyColor(p.consistency);
                return (
                  <tr key={p.name} className="border-b border-line/60 hover:bg-paper/60">
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
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

/* ================================================================ 業界データ */

async function IndustrySection({ period }: { period?: string }) {
  const curYear = new Date().getFullYear();
  const { filter, label, key } = parsePeriod(period, curYear);

  const [volumeAll, scorecards, vas, popular, topAni, topMal, genreInsights] = await Promise.all([
    getSeasonVolume().catch((): SeasonVolume[] => []),
    getStudioScorecards({ limit: 20 }).catch((): StudioScorecard[] => []),
    getVaRanking(filter, 24).catch((): VaStat[] => []),
    getPopular(filter, 12).catch((): RatedWork[] => []),
    getTopRated(filter, "anilist", 12).catch((): RatedWork[] => []),
    getTopRated(filter, "mal", 12).catch((): RatedWork[] => []),
    getGenreInsights().catch(() => [] as GenreInsight[]),
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
                      <span className="font-medium text-ink line-clamp-1">{sc.studio}</span>
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
