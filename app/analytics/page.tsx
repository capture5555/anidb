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
import { getFastStart, type FastStartRow } from "@/lib/analytics/fastStart";
import { getRisers, type RiserRow } from "@/lib/analytics/risers";
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
  getAllSyncRuns,
  type CollectionJob,
  type CollectionGap,
  type SyncRunRow,
} from "@/lib/analytics/collectionHealth";
import {
  getCohortXBuzz,
  getXBuzzVsJikkyo,
  getEpisodeBuzzLeaders,
  getXBuzzTopicLeaders,
  getAwarenessHeatScatter,
  type CohortXBuzz,
  type XBuzzVsJikkyo,
  type EpisodeBuzzLeader,
  type XTopicLeader,
  type AwarenessHeatRow,
} from "@/lib/analytics/xbuzz";
import { getSeasonComment } from "@/lib/analytics/seasonComment";
import { seasonSummary, studioInsight, vaInsight, genreOpportunity, franchiseInsight, compareInsight, compareStaffInsight, toPercentileRank } from "@/lib/analytics/insights";
import {
  getTimeslotHeatmap,
  getTimeslotCompetition,
  timeslotInsight,
  TIMESLOT_WEEKDAYS,
  type TimeslotHeatmap,
  type TimeslotCell,
  type TimeslotCompetition,
  type TimeslotCompetitionSlot,
} from "@/lib/analytics/timeslots";
import { AutoInsight } from "@/components/AutoInsight";
import { RetentionChart } from "@/components/charts/RetentionChart";
import { HotProgramsPanel } from "@/components/charts/HotProgramsPanel";
import { SectionNote } from "@/components/charts/WorkAnalysisSections";
import { SeasonOverviewHeatmap } from "@/components/charts/SeasonOverviewHeatmap";
import {
  hotProgramsComment,
  retentionSeriesComment,
  peakMomentsComment,
  reactionRankingComment,
  cohortXBuzzComment,
  xBuzzVsJikkyoComment,
  epLeadersComment,
  topicsComment,
  overallRankingComment,
  vaScorecardComment,
  staffBucketComment,
  studioBucketComment,
  popularRankingComment,
  ratedRankingComment,
  genreTrendsComment,
  awarenessHeatComment,
  globalGapComment,
  fastStartComment,
  seasonHeatmapComment,
  risersComment,
  sequelProspectComment,
  timeslotCompetitionComment,
} from "@/lib/analytics/sectionComments";
import {
  getOverallRanking,
  type OverallRankingRow,
} from "@/lib/analytics/overallRanking";
import {
  getGlobalGap,
  type GlobalGapRow,
  type GlobalGapKind,
} from "@/lib/analytics/globalGap";
import {
  getSequelProspect,
  type SequelProspectRow,
  type SequelSignal,
} from "@/lib/analytics/sequelProspect";
import { QuadrantScatter } from "@/components/charts/QuadrantScatter";
import { SEASON_LABELS, SEASON_ORDER } from "@/lib/season";
import { formatPopularity, formatAirShort } from "@/lib/format";
import { WorkCover } from "@/components/WorkCover";
import { CsvExportButton } from "@/components/CsvExportButton";
import type { Season } from "@/lib/types";
import { genreJa } from "@/lib/genres";

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

/* ================================================================ ロール別プリセット */

type RoleKey = "all" | "production" | "pr" | "hr" | "programming";

interface RolePresetItem {
  label: string;
  description: string;
  href: string;
}

interface RoleDef {
  key: RoleKey;
  label: string;
  items: RolePresetItem[];
}

const ROLE_DEFS: RoleDef[] = [
  {
    key: "all",
    label: "総合",
    items: [
      {
        label: "総合ランキング（今期）",
        description: "5シグナルを合成した今期クール横断スコア。全体の俯瞰に。",
        href: "/analytics",
      },
      {
        label: "今期の所感（AI）",
        description: "Grok x_search による今クールの傾向・注目作サマリー。",
        href: "/analytics/ai-log",
      },
      {
        label: "視聴分析タブ",
        description: "継続率・盛り上がり・リアクション傾向などの視聴データ全般。",
        href: "/analytics",
      },
      {
        label: "Xバズタブ",
        description: "SNS 上の話題量・センチメント・急上昇作品。",
        href: "/analytics?view=buzz",
      },
      {
        label: "業界データタブ",
        description: "スタジオ・ジャンル・フランチャイズなど業界横断の指標。",
        href: "/analytics?view=industry",
      },
    ],
  },
  {
    key: "production",
    label: "制作",
    items: [
      {
        label: "話数別3面比較（作品ページ）",
        description: "各回の実況・Xバズ・Annict記録を重ねて確認。どの回が刺さったかを把握。",
        href: "/analytics",
      },
      {
        label: "シーズン俯瞰ヒートマップ",
        description: "今期全作品×話数の実況コメントを俯瞰。盛り上がった回を即見。",
        href: "/analytics",
      },
      {
        label: "リアクション別ランキング（笑い・泣き・作画）",
        description: "実況コメントを分類し、作画言及率・笑い率・感動率でランキング。質の軸を確認。",
        href: "/analytics",
      },
      {
        label: "クール残留カーブ一覧",
        description: "全作品の話数ごと継続率を小多数比較。脱落タイミングが掴める。",
        href: "/analytics",
      },
      {
        label: "クール診断タブ",
        description: "今クールのスコアカード。総合ランキングと信号強度をまとめて確認。",
        href: "/analytics?view=scorecard",
      },
    ],
  },
  {
    key: "pr",
    label: "広報・宣伝",
    items: [
      {
        label: "急上昇アラート",
        description: "直近話で前話平均より大きく伸びた作品。朝チェック・PR効果測定に。",
        href: "/analytics",
      },
      {
        label: "認知 × 熱量 象限マップ（Xバズ）",
        description: "「総合ヒット・PR先行・ファン型ダークホース・様子見」の4象限で作品位置づけを可視化。",
        href: "/analytics?view=buzz",
      },
      {
        label: "初速スコア（立ち上がりの強さ）",
        description: "第1話の実況・Xバズのクール内相対順位。初動の強弱を定量確認。",
        href: "/analytics",
      },
      {
        label: "クール内Xバズランキング",
        description: "今期作品の最新Xバズ量をランキング。センチメント（ポジ/混合/ネガ）も一覧。",
        href: "/analytics?view=buzz",
      },
      {
        label: "話題ワード（クール横断トピック）",
        description: "複数作品に跨がるXの話題キーワード。クール全体の関心マップ。",
        href: "/analytics?view=buzz",
      },
    ],
  },
  {
    key: "hr",
    label: "人事・キャスティング",
    items: [
      {
        label: "声優スコアカード",
        description: "声優ごとの出演作品スコア・打率・ブレイク兆候。起用判断の参考に。",
        href: "/analytics?view=people",
      },
      {
        label: "スタッフスコアカード",
        description: "監督・シリーズ構成ほか職種ごとに作品の評価傾向を集計。",
        href: "/analytics?view=people",
      },
      {
        label: "声優比較（サイドバイサイド）",
        description: "2名の声優を並べて出演作・スコアを比較。オーディション前後の検討に。",
        href: "/analytics?view=people",
      },
      {
        label: "人気ランキング（Annict）",
        description: "ウォッチャー数が多い作品一覧。認知度の高い出演歴を確認。",
        href: "/analytics?view=industry",
      },
    ],
  },
  {
    key: "programming",
    label: "編成・配信",
    items: [
      {
        label: "放送曜日×時間帯ヒートマップ",
        description: "実況コメント平均で「枠の盛り上がり」を可視化。枠競合・編成の最適化に。",
        href: "/analytics",
      },
      {
        label: "ジャンル需給・動向（業界データ）",
        description: "ジャンル別の平均スコア・作品数・伸び率。需給ギャップと配信強化余地を把握。",
        href: "/analytics?view=industry",
      },
      {
        label: "総合ランキング（今期）",
        description: "今期の作品横断スコア。どの作品を優先ラインナップに置くかの参考。",
        href: "/analytics",
      },
      {
        label: "国内 × 海外乖離（グローバルギャップ）",
        description: "AniList（海外）とAnnict（国内）スコアの差が大きい作品。配信戦略の根拠に。",
        href: "/analytics?view=industry",
      },
      {
        label: "フランチャイズ勢い（業界データ）",
        description: "続編・シリーズの勢い指数。続編投資・配信ライブラリ編成の参考に。",
        href: "/analytics?view=industry",
      },
    ],
  },
];

/**
 * 現在の searchParams を保持しつつ role だけ差し替えた URL を生成するヘルパー。
 * サーバーコンポーネントなので純粋な文字列操作で組み立てる。
 */
function buildRoleHref(
  role: RoleKey,
  currentSp: {
    view?: string;
    period?: string;
    basis?: string;
    role?: string;
  }
): string {
  const params = new URLSearchParams();
  if (currentSp.view) params.set("view", currentSp.view);
  if (currentSp.period) params.set("period", currentSp.period);
  if (currentSp.basis) params.set("basis", currentSp.basis);
  if (role !== "all") params.set("role", role);
  const qs = params.toString();
  return `/analytics${qs ? `?${qs}` : ""}`;
}

/**
 * ロール選択チップ＋注目ポイントカード。
 * タイトルの下・タブの上に配置する。
 */
function RolePresetsPanel({
  currentRole,
  currentSp,
}: {
  currentRole: RoleKey;
  currentSp: {
    view?: string;
    period?: string;
    basis?: string;
    role?: string;
  };
}) {
  const roleDef = ROLE_DEFS.find((r) => r.key === currentRole) ?? ROLE_DEFS[0]!;

  return (
    <div className="mb-5">
      {/* ロール選択チップ列 */}
      <div className="flex flex-wrap gap-2 mb-3">
        {ROLE_DEFS.map((rd) => {
          const active = rd.key === currentRole;
          return (
            <Link
              key={rd.key}
              href={buildRoleHref(rd.key, currentSp)}
              className={`inline-block whitespace-nowrap px-3.5 py-2 sm:py-1.5 rounded-full text-xs font-bold transition-colors ${
                active
                  ? "bg-accent text-white"
                  : "bg-surface border border-line text-ink-soft hover:border-line-strong hover:text-ink"
              }`}
            >
              {rd.label}
            </Link>
          );
        })}
      </div>

      {/* 注目ポイントカード */}
      <div className="card p-4 sm:p-5 border-l-4 border-l-accent/60">
        <p className="text-[0.68rem] font-black text-accent mb-3 uppercase tracking-wide">
          {roleDef.label} ─ 注目ポイント
        </p>
        <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
          {roleDef.items.map((item) => (
            <li key={item.label}>
              <Link
                href={item.href}
                className="flex flex-col gap-0.5 rounded-lg border border-line bg-paper px-3.5 py-2.5 hover:border-accent/50 hover:bg-paper transition-colors group"
              >
                <span className="text-xs font-bold text-ink group-hover:text-primary transition-colors leading-snug">
                  {item.label} →
                </span>
                <span className="text-[0.68rem] text-muted leading-relaxed">
                  {item.description}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

export default async function AnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<{
    view?: string;
    period?: string;
    basis?: string;
    compare?: string;
    comparestaff?: string;
    role?: string;
    // 人材タブ・声優スコアカード sort
    vasort?: string;
    vadir?: string;
    // 人材タブ・スタッフ sort（接頭辞 st_ + roleKey）
    stsort?: string;
    stdir?: string;
    strole?: string;
    // 業界データタブ・制作会社スコアカード sort
    scsort?: string;
    scdir?: string;
    // 業界データタブ・ジャンル動向 sort
    gsort?: string;
    gdir?: string;
  }>;
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
  // ロール別プリセット（?role=all|production|pr|hr|programming）
  const VALID_ROLES: RoleKey[] = ["all", "production", "pr", "hr", "programming"];
  const role: RoleKey =
    sp.role && (VALID_ROLES as string[]).includes(sp.role)
      ? (sp.role as RoleKey)
      : "all";
  // 今期の所感（Grok x_search 由来・cron生成のスナップショット）。未生成なら非表示。
  const seasonComment = await getSeasonComment().catch(() => null);

  return (
    <div className="mx-auto max-w-6xl px-4 sm:px-6">
      <div className="flex items-baseline gap-3 pt-6 sm:pt-8 mb-3">
        <h1 className="text-xl sm:text-2xl font-black text-ink">アニメ分析</h1>
      </div>

      {seasonComment && (
        <div className="card p-4 sm:p-5 mb-5 border-l-4 border-l-accent">
          <div className="flex items-center gap-2 mb-1.5 flex-wrap">
            <span className="text-[0.7rem] font-black text-accent">AIの所感</span>
            <span className="text-[0.66rem] text-muted">
              Grok・X / {seasonComment.label}
              {seasonComment.generatedAt && ` ・ ${formatAirShort(seasonComment.generatedAt)} 生成`}
            </span>
            <Link
              href="/analytics/ai-log"
              className="ml-auto text-[0.66rem] font-bold text-primary hover:underline underline-offset-2 whitespace-nowrap"
            >
              AIコメント履歴 →
            </Link>
          </div>
          <p className="text-[0.9rem] leading-[1.8] text-ink-soft whitespace-pre-wrap">
            {seasonComment.text}
          </p>
        </div>
      )}

      {/* ロール別プリセット */}
      <RolePresetsPanel
        currentRole={role}
        currentSp={{ view: sp.view, period: sp.period, basis: sp.basis, role: sp.role }}
      />

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
                className={`inline-block whitespace-nowrap px-3 sm:px-7 py-3 sm:py-2.5 font-bold text-[0.9rem] sm:text-[0.95rem] border-b-[3px] transition-colors ${
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
        <PeopleSection
          compare={sp.compare}
          comparestaff={sp.comparestaff}
          vasort={sp.vasort}
          vadir={sp.vadir}
          stsort={sp.stsort}
          stdir={sp.stdir}
          strole={sp.strole}
        />
      ) : view === "collection" ? (
        <CollectionSection />
      ) : view === "buzz" ? (
        <BuzzSection />
      ) : (
        <IndustrySection period={sp.period} scsort={sp.scsort} scdir={sp.scdir} gsort={sp.gsort} gdir={sp.gdir} />
      )}

      <div className="h-16" />
    </div>
  );
}

/* ================================================================ 総合ランキングカード */

/**
 * 今期クールの総合ランキングを表示するカード。
 * 各シグナルのパーセンタイルを細い横バーで表示し、CSVエクスポートにも対応。
 */
function OverallRankingCard({ rows }: { rows: OverallRankingRow[] }) {
  const comment = overallRankingComment(rows);

  const csvHeaders = ["順位", "作品名", "総合スコア", "認知", "批評", "実況", "X", "継続/満足"];
  const csvRows = rows.map((r, i) => [
    i + 1,
    r.title,
    r.score,
    r.signals.awareness ?? "",
    r.signals.review ?? "",
    r.signals.jikkyo ?? "",
    r.signals.xbuzz ?? "",
    r.signals.retention ?? "",
  ] as (string | number | null)[]);

  return (
    <section className="card p-5 sm:p-6">
      <div className="flex items-center justify-between gap-3 flex-wrap mb-1">
        <h2 className="section-title text-lg">総合ランキング（今期）</h2>
        <CsvExportButton filename="overall_ranking.csv" headers={csvHeaders} rows={csvRows} />
      </div>
      <p className="text-xs text-muted mb-4">
        認知（Annictウォッチャー数）・批評（AniList/MALスコア）・実況エンゲージ（ニコニコ実況コメント総数）・
        Xバズ・継続/満足度の5シグナルをコホート内パーセンタイルで正規化し加重平均したスコア(0〜100)。
        欠測シグナルは残り重みで自動再正規化。
      </p>
      <SectionNote text={comment} />
      <ol className="divide-y divide-line">
        {rows.slice(0, 20).map((row, i) => (
          <li key={row.workId} className="flex items-start gap-3 py-2.5">
            <span
              className={`w-6 text-center font-black tabular-nums shrink-0 mt-1 ${
                i < 3 ? "text-accent" : "text-muted"
              }`}
            >
              {i + 1}
            </span>
            <Link href={`/analytics/works/${row.workId}`} className="shrink-0">
              <WorkCover
                id={row.workId}
                title={row.title}
                url={row.posterUrl}
                className="w-9 h-12 rounded-md"
              />
            </Link>
            <div className="min-w-0 flex-1">
              <Link
                href={`/analytics/works/${row.workId}`}
                className="block text-sm font-bold text-ink hover:text-primary transition truncate"
              >
                {row.title}
              </Link>
              {/* シグナル内訳バー */}
              <div className="mt-1 grid grid-cols-5 gap-x-2 gap-y-0.5">
                {(
                  [
                    { label: "認知", value: row.signals.awareness },
                    { label: "批評", value: row.signals.review },
                    { label: "実況", value: row.signals.jikkyo },
                    { label: "X", value: row.signals.xbuzz },
                    { label: "継続", value: row.signals.retention },
                  ] as { label: string; value: number | null }[]
                ).map(({ label, value }) => (
                  <div key={label}>
                    <div className="text-[0.55rem] text-muted leading-none mb-0.5">{label}</div>
                    <div className="h-1.5 rounded-full bg-line overflow-hidden">
                      {value != null ? (
                        <div
                          className="h-full rounded-full bg-accent"
                          style={{ width: `${value}%` }}
                        />
                      ) : (
                        <div className="h-full rounded-full bg-line" style={{ width: "0%" }} />
                      )}
                    </div>
                    <div className="text-[0.55rem] text-muted tabular-nums mt-0.5 text-right">
                      {value != null ? Math.round(value) : "—"}
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <div className="shrink-0 text-right min-w-[3rem]">
              <span className="block font-black text-accent tabular-nums text-base">
                {row.score.toFixed(0)}
              </span>
              <span className="block text-[0.62rem] text-muted">pts</span>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}

/* ================================================================ 視聴分析 */

async function ViewingSection({ basis }: { basis: "jikkyo" | "annict" }) {
  const [retention, jikkyoRetention, hot, peaks, ratios, timeslots, overallRanking, fastStart, risers, competition] = await Promise.all([
    basis === "annict"
      ? getRetentionSeries(100).catch(() => ({ snapshotDate: null, series: [] }))
      : getJikkyoRetentionSeries(100).catch(() => ({ snapshotDate: null, series: [] })),
    // シーズン俯瞰ヒートマップは常に実況コメント基準で表示するため、別途取得（basis=jikkyo のときは上と共有されキャッシュヒット）
    basis === "jikkyo"
      ? Promise.resolve(null) // jikkyo のときは retention を流用
      : getJikkyoRetentionSeries(100).catch(() => ({ snapshotDate: null, series: [] })),
    getHotPrograms(6, 14).catch(() => []),
    getPeakMoments(10).catch(() => []),
    getReactionRatios(1000).catch(() => []),
    getTimeslotHeatmap().catch((): TimeslotHeatmap => ({ cells: [], maxAvg: 0 })),
    getOverallRanking().catch((): OverallRankingRow[] => []),
    getFastStart(30).catch((): FastStartRow[] => []),
    getRisers(10).catch((): RiserRow[] => []),
    getTimeslotCompetition().catch((): TimeslotCompetition => ({ slots: [] })),
  ]);
  // シーズン俯瞰ヒートマップ用: 常に実況コメントデータを使う
  const heatmapSeries = (jikkyoRetention ?? retention).series;

  return (
    <div className="space-y-5">
      {/* 総合ランキング */}
      {overallRanking.length > 0 && (
        <OverallRankingCard rows={overallRanking} />
      )}

      {/* 急上昇アラート（直近の伸び） */}
      <RisersAlertCard rows={risers} />

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
        <SectionNote text={retentionSeriesComment(retention.series)} />
        <RetentionChart series={retention.series.slice(0, 12)} />
      </section>

      {/* クール残留カーブ一覧（small multiples） */}
      {retention.series.length > 0 && (
        <section className="card p-5 sm:p-6">
          <h2 className="section-title text-lg mb-1">
            クール残留カーブ一覧
            <span className="ml-2 text-xs font-normal text-muted tabular-nums">
              {retention.series.length}作品
            </span>
          </h2>
          <p className="text-xs text-muted mb-4">
            今期シーズンの全作品（2話以上データあり）の残留率カーブをまとめて表示。1話を100%としたときの推移を作品横断で比較できます。
            右端の数値は最新話の残留率。母数は
            {basis === "annict" ? "Annictの記録ユーザー" : "ニコニコ実況のコメント"}（テレビ視聴率ではありません）。
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
            {retention.series.map((s) => (
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

      {/* シーズン俯瞰ヒートマップ */}
      {heatmapSeries.length >= 2 && (
        <section className="card p-5 sm:p-6">
          <h2 className="section-title text-lg mb-1">シーズン俯瞰ヒートマップ</h2>
          <p className="text-xs text-muted mb-4">
            今期作品×話数の実況コメント数を俯瞰。濃いほど盛り上がった回。色は log スケールで全体最大を基準に正規化（人気順上位30作品を表示）。
          </p>
          <SectionNote text={seasonHeatmapComment(heatmapSeries)} />
          <SeasonOverviewHeatmap rows={heatmapSeries} />
        </section>
      )}

      {/* 盛り上がり */}
      <section className="card p-5 sm:p-6">
        <h2 className="section-title text-lg mb-1">盛り上がった放送回（直近2週間）</h2>
        <p className="text-xs text-muted mb-5">
          ニコニコ実況のコメント数を分単位で集計し、コメント内容から「笑い・興奮・感動」などのリアクションを分類。
          ▲はコメントが集中したピーク。グラフにカーソルを合わせると内訳が見られます。
        </p>
        <SectionNote text={hotProgramsComment(hot)} />
        <HotProgramsPanel programs={hot} />
      </section>

      {/* 瞬間最大風速 */}
      {peaks.length > 0 && (
        <section className="card p-5 sm:p-6">
          <h2 className="section-title text-lg mb-1">瞬間最大風速ランキング（今期）</h2>
          <p className="text-xs text-muted mb-4">
            「1分間に流れたコメント数」の最大値が大きかった瞬間。その時に何が流れたかも見られます。
          </p>
          <SectionNote text={peakMomentsComment(peaks)} />
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
          <SectionNote text={reactionRankingComment(ratios)} />
          <div className="grid grid-cols-1 md:grid-cols-3 gap-x-8 gap-y-6">
            <RatioColumn works={ratios} category="laugh" title="一番笑えるアニメ" color="#f5a623" label="笑い率" />
            <RatioColumn works={ratios} category="cry" title="一番泣けるアニメ" color="#2f6fdb" label="感動率" />
            <RatioColumn works={ratios} category="sakuga" title="作画が語られるアニメ" color="#2ebd85" label="作画言及率" />
          </div>
        </section>
      )}

      {/* 放送曜日×時間帯ヒートマップ */}
      <TimeslotHeatmapCard heatmap={timeslots} />

      {/* 混雑スロット（競合の多い枠） */}
      <TimeslotCompetitionCard competition={competition} />

      {/* 初速ランキング（立ち上がりの強さ） */}
      {fastStart.length > 0 && (
        <FastStartRankingCard rows={fastStart} />
      )}

      <p className="text-xs text-muted leading-relaxed">
        ※ データソース: Annict（記録数）・ニコニコ実況 過去ログAPI（コメント）。
        どちらも各サービスの利用者を母数とした参考値であり、テレビの視聴率・視聴者数を示すものではありません。
      </p>
      <div className="text-right">
        <Link
          href="/analytics/guide"
          className="text-xs font-bold text-primary hover:underline underline-offset-2"
        >
          指標ガイド・データソースについて →
        </Link>
      </div>
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

/* ---------------------------------------------------------------- 混雑スロット（競合の多い枠） */

/**
 * 混雑スロット（競合の多い枠）カード（サーバーコンポーネント）。
 * 作品数の多いスロット上位を、曜日・時間帯ラベル＋作品ポスター小＋作品名（/analytics/works/[id]へリンク）で一覧する。
 * データが薄い（2作品以上のスロットが1つもない）場合は非表示。
 */
function TimeslotCompetitionCard({ competition }: { competition: TimeslotCompetition }) {
  const { slots } = competition;
  // 2作品以上が競合するスロットのみ表示
  const contested = slots.filter((s) => s.count >= 2);
  if (contested.length === 0) return null;

  const comment = timeslotCompetitionComment(contested);
  // 上位8スロットを表示（それ以上は省略）
  const topSlots = contested.slice(0, 8);

  const slotLabel = (s: TimeslotCompetitionSlot) => {
    const dow = TIMESLOT_WEEKDAYS[s.weekday] ?? "?";
    const h = s.hour >= 24 ? `深夜${s.hour}時` : `${s.hour}時`;
    return `${dow}${h}`;
  };

  return (
    <section className="card p-5 sm:p-6">
      <h2 className="section-title text-lg mb-1">混雑スロット（競合の多い枠）</h2>
      <p className="text-xs text-muted mb-4">
        今期放送中作品を曜日×時間帯スロットに割り当て、同一枠に並ぶ作品数を集計。
        枠競合が多いほど視聴者の分散が起きやすい。編成・配信の優先枠検討に。
      </p>
      <SectionNote text={comment} />
      <ol className="space-y-4">
        {topSlots.map((slot) => {
          const MAX_VISIBLE = 6;
          const visible = slot.works.slice(0, MAX_VISIBLE);
          const overflow = slot.count - MAX_VISIBLE;
          return (
            <li key={`${slot.weekday}:${slot.hour}`} className="border border-line rounded-lg p-3">
              <div className="flex items-center gap-2 mb-2.5">
                <span className="text-sm font-black text-ink">{slotLabel(slot)}</span>
                <span className="text-xs font-bold text-accent tabular-nums">
                  {slot.count}作品
                </span>
              </div>
              <div className="flex flex-wrap gap-2">
                {visible.map((work) => (
                  <Link
                    key={work.workId}
                    href={`/analytics/works/${work.workId}`}
                    className="flex items-center gap-1.5 rounded-md border border-line bg-paper px-2 py-1 hover:border-accent/50 transition group"
                  >
                    <WorkCover
                      id={work.workId}
                      title={work.title}
                      url={work.posterUrl}
                      className="w-6 h-8 rounded-sm shrink-0"
                    />
                    <span className="text-xs font-bold text-ink group-hover:text-primary transition max-w-[10rem] truncate">
                      {work.title}
                    </span>
                  </Link>
                ))}
                {overflow > 0 && (
                  <span className="flex items-center px-2 py-1 text-xs text-muted tabular-nums">
                    他{overflow}作品
                  </span>
                )}
              </div>
            </li>
          );
        })}
      </ol>
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

/* ================================================================ 急上昇アラート */

/**
 * 急上昇アラート（直近の伸び）カード（サーバーコンポーネント）。
 * 広報が朝にチェックする用途: 最新話の実況コメント数が前話までの平均より大きく伸びた作品を表示。
 */
function RisersAlertCard({ rows }: { rows: RiserRow[] }) {
  const comment = risersComment(rows);
  const maxDelta = Math.max(1, ...rows.map((r) => r.deltaPct));

  return (
    <section className="card p-5 sm:p-6">
      <h2 className="section-title text-lg mb-1">急上昇アラート（直近の伸び）</h2>
      <p className="text-xs text-muted mb-4">
        実況コメント数が直近話で前話までの平均を大きく上回った作品（参考値）
      </p>
      <SectionNote text={comment} />
      {rows.length === 0 ? (
        <p className="text-sm text-muted">直近で大きく伸びた作品はありません。</p>
      ) : (
        <ol className="divide-y divide-line">
          {rows.map((row, i) => (
            <li key={row.workId} className="flex items-start gap-3 py-2.5">
              <span
                className={`w-6 text-center font-black tabular-nums shrink-0 mt-1 ${
                  i < 3 ? "text-accent" : "text-muted"
                }`}
              >
                {i + 1}
              </span>
              <Link href={`/analytics/works/${row.workId}`} className="shrink-0">
                <WorkCover
                  id={row.workId}
                  title={row.title}
                  url={row.posterUrl}
                  className="w-9 h-12 rounded-md"
                />
              </Link>
              <div className="min-w-0 flex-1">
                <Link
                  href={`/analytics/works/${row.workId}`}
                  className="block text-sm font-bold text-ink hover:text-primary transition truncate"
                >
                  {row.title}
                  {row.latestLabel && (
                    <span className="font-normal text-ink-soft ml-1.5">{row.latestLabel}</span>
                  )}
                </Link>
                <div className="flex items-center gap-2 mt-1 flex-wrap">
                  <span className="text-xs text-muted tabular-nums">
                    {row.latestComments.toLocaleString()}コメ
                  </span>
                  {/* 伸び率バー */}
                  <div className="flex-1 h-1.5 rounded-full bg-line overflow-hidden max-w-[120px]">
                    <div
                      className="h-full rounded-full bg-rose-500"
                      style={{ width: `${Math.min(100, (row.deltaPct / maxDelta) * 100)}%` }}
                    />
                  </div>
                  <span className="text-xs font-black tabular-nums text-rose-600 shrink-0">
                    前話まで平均比 +{Math.round(row.deltaPct)}%
                  </span>
                </div>
                <p className="text-[0.66rem] text-muted mt-0.5">
                  前話まで平均 {row.priorAvg.toLocaleString()}コメ
                </p>
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

/* ================================================================ 初速ランキング */

/**
 * 初速ランキング（立ち上がりの強さ）カード（サーバーコンポーネント）。
 * 宣伝・製作委員会向け: 第1話の実況コメント数とXバズをコホート内パーセンタイルで正規化し合成したスコアを表示。
 */
function FastStartRankingCard({ rows }: { rows: FastStartRow[] }) {
  const comment = fastStartComment(rows);

  const csvHeaders = ["順位", "作品名", "初速スコア", "実況初速%ile", "X初速%ile", "第1話実況コメント数"];
  const csvRows = rows.map((r, i) => [
    i + 1,
    r.title,
    r.score,
    r.jikkyoPctl,
    r.xPctl ?? "",
    r.ep1Comments,
  ] as (string | number)[]);

  const maxEp1 = Math.max(1, ...rows.map((r) => r.ep1Comments));

  return (
    <section className="card p-5 sm:p-6">
      <div className="flex items-center justify-between gap-3 flex-wrap mb-1">
        <h2 className="section-title text-lg">初速ランキング（立ち上がりの強さ）</h2>
        <CsvExportButton filename="fast_start_ranking.csv" headers={csvHeaders} rows={csvRows} />
      </div>
      <p className="text-xs text-muted mb-1">
        宣伝・製作委員会向け: 第1話放送直後の盛り上がりを「実況初速」と「X初速」でスコア化。
        今期クール内の相対的な立ち上がりの強さを示します。
      </p>
      <p className="text-[0.68rem] text-muted mb-4 leading-relaxed">
        ※ 初速＝第1話の実況コメント数とXバズのクール内相対位置（パーセンタイル）。スコア＝実況初速%×0.6 + X初速%×0.4（X欠測時は実況のみで再正規化）。
      </p>
      <SectionNote text={comment} />
      <ol className="divide-y divide-line">
        {rows.slice(0, 20).map((row, i) => (
          <li key={row.workId} className="flex items-start gap-3 py-2.5">
            <span
              className={`w-6 text-center font-black tabular-nums shrink-0 mt-1 ${
                i < 3 ? "text-accent" : "text-muted"
              }`}
            >
              {i + 1}
            </span>
            <Link href={`/analytics/works/${row.workId}`} className="shrink-0">
              <WorkCover
                id={row.workId}
                title={row.title}
                url={row.posterUrl}
                className="w-9 h-12 rounded-md"
              />
            </Link>
            <div className="min-w-0 flex-1">
              <Link
                href={`/analytics/works/${row.workId}`}
                className="block text-sm font-bold text-ink hover:text-primary transition truncate"
              >
                {row.title}
              </Link>
              {/* パーセンタイル内訳バー（実況初速 / X初速） */}
              <div className="mt-1 grid grid-cols-2 gap-x-3 gap-y-0.5 max-w-[260px]">
                {(
                  [
                    { label: "実況", value: row.jikkyoPctl, color: "#2f6fdb" },
                    { label: "X", value: row.xPctl, color: "#f5a623" },
                  ] as { label: string; value: number | null; color: string }[]
                ).map(({ label, value, color }) => (
                  <div key={label}>
                    <div className="text-[0.55rem] text-muted leading-none mb-0.5">{label}</div>
                    <div className="h-1.5 rounded-full bg-line overflow-hidden">
                      {value != null ? (
                        <div
                          className="h-full rounded-full"
                          style={{ width: `${value}%`, backgroundColor: color }}
                        />
                      ) : (
                        <div className="h-full rounded-full bg-line" style={{ width: "0%" }} />
                      )}
                    </div>
                    <div className="text-[0.55rem] text-muted tabular-nums mt-0.5 text-right">
                      {value != null ? Math.round(value) : "—"}
                    </div>
                  </div>
                ))}
              </div>
              {/* 第1話実況コメント数バー */}
              <div className="mt-1.5 flex items-center gap-1.5">
                <span className="text-[0.6rem] text-muted shrink-0">第1話</span>
                <div className="flex-1 h-1.5 rounded-full bg-line overflow-hidden max-w-[120px]">
                  <div
                    className="h-full rounded-full bg-accent/50"
                    style={{ width: `${Math.min(100, (row.ep1Comments / maxEp1) * 100)}%` }}
                  />
                </div>
                <span className="text-[0.62rem] font-bold tabular-nums text-ink-soft shrink-0">
                  {row.ep1Comments.toLocaleString()}
                </span>
                <span className="text-[0.55rem] text-muted shrink-0">コメ</span>
              </div>
            </div>
            <div className="shrink-0 text-right min-w-[3rem]">
              <span className="block font-black text-accent tabular-nums text-base">
                {row.score.toFixed(0)}
              </span>
              <span className="block text-[0.62rem] text-muted">pts</span>
            </div>
          </li>
        ))}
      </ol>
    </section>
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

/** 概況ストリップの1指標。 */
function BuzzStat({ label, value, unit }: { label: string; value: number; unit?: string }) {
  return (
    <div className="rounded-lg bg-paper/60 px-3 py-2.5">
      <p className="text-[0.68rem] font-bold text-muted">{label}</p>
      <p className="text-xl font-black text-ink tabular-nums leading-tight mt-0.5">
        {value.toLocaleString()}
        {unit && <span className="text-xs font-bold text-muted ml-0.5">{unit}</span>}
      </p>
    </div>
  );
}

/** ポジ/賛否/ネガの内訳を1本の積み上げバーで表す。 */
function SentimentBar({
  counts,
  total,
}: {
  counts: { positive: number; mixed: number; negative: number };
  total: number;
}) {
  const seg = [
    { key: "positive", n: counts.positive, cls: "bg-emerald-400", label: "ポジティブ" },
    { key: "mixed", n: counts.mixed, cls: "bg-amber-400", label: "賛否両論" },
    { key: "negative", n: counts.negative, cls: "bg-rose-400", label: "ネガティブ" },
  ].filter((s) => s.n > 0);
  return (
    <div>
      <div className="flex h-3 w-full overflow-hidden rounded-full bg-paper">
        {seg.map((s) => (
          <div
            key={s.key}
            className={s.cls}
            style={{ width: `${(s.n / total) * 100}%` }}
            title={`${s.label} ${s.n}作品`}
          />
        ))}
      </div>
      <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1">
        {seg.map((s) => (
          <span key={s.key} className="inline-flex items-center gap-1.5 text-[0.7rem] text-ink-soft">
            <span className={`h-2 w-2 rounded-sm ${s.cls}`} />
            {s.label}
            <span className="font-bold tabular-nums">
              {s.n}（{Math.round((s.n / total) * 100)}%）
            </span>
          </span>
        ))}
      </div>
    </div>
  );
}

/** トピックを頻度に応じた大きさのチップ群（タグクラウド風）で表示。 */
function TopicCloud({ topics }: { topics: XTopicLeader[] }) {
  const max = Math.max(1, ...topics.map((t) => t.count));
  return (
    <ul className="flex flex-wrap gap-2">
      {topics.map((t) => {
        // 件数を 0.78rem〜1.1rem にマップ。最頻出ほど大きく濃く。
        const ratio = t.count / max;
        const fontRem = 0.78 + ratio * 0.32;
        const strong = ratio >= 0.6;
        return (
          <li
            key={t.topic}
            className={`rounded-full px-3 py-1 font-medium ${
              strong ? "bg-accent/15 text-ink" : "bg-paper text-ink-soft"
            }`}
            style={{ fontSize: `${fontRem.toFixed(2)}rem` }}
            title={`${t.count}作品: ${t.sampleTitles.join(" / ")}`}
          >
            {t.topic}
            <span className="ml-1 text-[0.66rem] font-bold text-muted tabular-nums align-top">
              {t.count}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

async function BuzzSection() {
  const [cohort, vsJikkyo, epLeaders, topics, awarenessHeat] = await Promise.all([
    getCohortXBuzz(20).catch((): CohortXBuzz[] => []),
    getXBuzzVsJikkyo(30).catch((): XBuzzVsJikkyo[] => []),
    getEpisodeBuzzLeaders(12).catch((): EpisodeBuzzLeader[] => []),
    getXBuzzTopicLeaders(24).catch((): XTopicLeader[] => []),
    getAwarenessHeatScatter(40).catch((): AwarenessHeatRow[] => []),
  ]);

  // センチメント分布（ランキング母集団の内訳）。
  const sentCounts = { positive: 0, mixed: 0, negative: 0 };
  for (const c of cohort) {
    const s = (c.sentiment ?? "").toLowerCase();
    if (s === "positive") sentCounts.positive++;
    else if (s === "mixed") sentCounts.mixed++;
    else if (s === "negative") sentCounts.negative++;
  }
  const sentTotal = sentCounts.positive + sentCounts.mixed + sentCounts.negative;

  return (
    <div className="space-y-5">
      {/* 概況ストリップ */}
      {(cohort.length > 0 || epLeaders.length > 0) && (
        <section className="card p-5 sm:p-6">
          <h2 className="section-title text-lg mb-4">今期Xバズ概況</h2>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <BuzzStat label="追跡作品数" value={cohort.length} unit="作品" />
            <BuzzStat
              label="平均バズ"
              value={
                cohort.length > 0
                  ? Math.round((cohort.reduce((s, c) => s + c.volume, 0) / cohort.length) * 10) / 10
                  : 0
              }
              unit="/5"
            />
            <BuzzStat
              label="ポジティブ率"
              value={sentTotal > 0 ? Math.round((sentCounts.positive / sentTotal) * 100) : 0}
              unit="%"
            />
            <BuzzStat label="話題ワード" value={topics.length} unit="語" />
          </div>
          {sentTotal > 0 && (
            <div className="mt-4">
              <p className="text-xs font-bold text-muted mb-1.5">センチメント分布（追跡作品）</p>
              <SentimentBar counts={sentCounts} total={sentTotal} />
            </div>
          )}
        </section>
      )}

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
        <SectionNote text={cohortXBuzzComment(cohort)} />
        {cohort.length === 0 ? (
          <p className="text-sm text-muted">
            Xバズのデータがまだ十分に集まっていません。収集が進むと表示されます。
          </p>
        ) : (
          <ol className="divide-y divide-line">
            {cohort.map((c, i) => (
              <li key={c.workId} className="flex items-start gap-3 py-2.5">
                <span
                  className={`w-5 text-right font-black tabular-nums shrink-0 mt-0.5 ${
                    i < 3 ? "text-accent" : "text-muted"
                  }`}
                >
                  {i + 1}
                </span>
                <Link href={`/analytics/works/${c.workId}`} className="shrink-0">
                  <WorkCover id={c.workId} title={c.title} url={c.posterUrl} className="w-9 h-12 rounded-md" />
                </Link>
                <div className="flex-1 min-w-0">
                  <Link
                    href={`/analytics/works/${c.workId}`}
                    className="block text-sm font-bold text-ink hover:text-primary transition truncate"
                  >
                    {c.title}
                  </Link>
                  <div className="flex flex-wrap items-center gap-2 mt-1">
                    <BuzzVolumeGauge volume={c.volume} />
                    <span className="text-xs font-bold text-ink-soft tabular-nums shrink-0">
                      {Math.max(0, Math.min(5, Math.round(c.volume)))}/5
                    </span>
                    <BuzzSentimentChip sentiment={c.sentiment} />
                  </div>
                </div>
              </li>
            ))}
          </ol>
        )}
      </section>

      {/* 注目の話数（クール横断・話数別バズ上位） */}
      {epLeaders.length > 0 && (
        <section className="card p-5 sm:p-6">
          <div className="flex flex-wrap items-start justify-between gap-3 mb-1">
            <h2 className="section-title text-lg">注目の話数</h2>
            <CsvExportButton
              filename="X注目の話数"
              headers={["順位", "作品", "話数", "盛り上がり", "センチメント"]}
              rows={epLeaders.map((e, i) => [
                i + 1,
                e.title,
                e.episodeLabel,
                e.volume,
                e.sentiment ?? "",
              ])}
            />
          </div>
          <p className="text-xs text-muted mb-4">
            今期作品の「話数ごと」のXバズを横断で並べたもの。いまどの作品のどの話が刺さっているかが分かります。
          </p>
          <SectionNote text={epLeadersComment(epLeaders)} />
          <ol className="divide-y divide-line">
            {epLeaders.map((e, i) => (
              <li key={`${e.workId}-${e.episodeId ?? i}`} className="flex items-start gap-3 py-2.5">
                <span
                  className={`w-5 text-right font-black tabular-nums shrink-0 mt-0.5 ${
                    i < 3 ? "text-accent" : "text-muted"
                  }`}
                >
                  {i + 1}
                </span>
                <Link href={`/analytics/works/${e.workId}`} className="shrink-0">
                  <WorkCover id={e.workId} title={e.title} url={e.posterUrl} className="w-9 h-12 rounded-md" />
                </Link>
                <div className="flex-1 min-w-0">
                  <Link
                    href={`/analytics/works/${e.workId}`}
                    className="block text-sm font-bold text-ink hover:text-primary transition truncate"
                  >
                    {e.title}
                  </Link>
                  <span className="block text-[0.72rem] text-muted truncate">
                    {e.episodeLabel}
                    {e.topics[0] ? ` ・ ${e.topics[0]}` : ""}
                  </span>
                  <div className="flex flex-wrap items-center gap-2 mt-1">
                    <BuzzVolumeGauge volume={e.volume} />
                    <span className="text-xs font-bold text-ink-soft tabular-nums shrink-0">
                      {Math.max(0, Math.min(5, Math.round(e.volume)))}/5
                    </span>
                    <BuzzSentimentChip sentiment={e.sentiment} />
                  </div>
                </div>
              </li>
            ))}
          </ol>
        </section>
      )}

      {/* 話題ワード（クール横断トピックランキング） */}
      {topics.length > 0 && (
        <section className="card p-5 sm:p-6">
          <div className="flex flex-wrap items-start justify-between gap-3 mb-1">
            <h2 className="section-title text-lg">話題ワード</h2>
            <CsvExportButton
              filename="X話題ワード"
              headers={["トピック", "作品数", "代表作品"]}
              rows={topics.map((t) => [t.topic, t.count, t.sampleTitles.join(" / ")])}
            />
          </div>
          <p className="text-xs text-muted mb-4">
            今期作品のXバズ分析で複数作品にまたがって挙がっているキーワード。クール全体の関心の地図です。
          </p>
          <SectionNote text={topicsComment(topics)} />
          <TopicCloud topics={topics} />
        </section>
      )}

      {/* ニコ実況 × X 相関 */}
      <section className="card p-5 sm:p-6">
        <h2 className="section-title text-lg mb-1">ニコ実況 × X 相関</h2>
        <p className="text-xs text-muted mb-4">
          横＝ニコニコ実況のコメント総数（平方根スケール）、縦＝最新Xバズ volume（0〜5）。
          実況とXは母数（利用者層）が異なるため、両軸で位置づけを見ると「実況で熱いがXは静か」「Xで話題だが実況は静か（隠れ人気）」といった偏りが分かります。
        </p>
        <SectionNote text={xBuzzVsJikkyoComment(vsJikkyo)} />
        {vsJikkyo.length === 0 ? (
          <p className="text-sm text-muted">
            相関に必要なデータがまだ十分に集まっていません。収集が進むと表示されます。
          </p>
        ) : (
          <BuzzJikkyoScatter points={vsJikkyo} />
        )}
      </section>

      {/* 認知 × 熱量 象限マップ */}
      <section className="card p-5 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-3 mb-1">
          <h2 className="section-title text-lg">認知 × 熱量 象限マップ</h2>
          {awarenessHeat.length > 0 && (
            <CsvExportButton
              filename="認知熱量象限マップ"
              headers={["作品", "認知(ウォッチャー数)", "熱量(volume)", "象限"]}
              rows={awarenessHeat.map((r) => [
                r.title,
                r.popularity,
                r.volume,
                {
                  total_hit: "総合ヒット",
                  fan_darkhorse: "ファン型ダークホース",
                  general_pr: "一般・PR先行",
                  watching: "様子見",
                }[r.quadrant],
              ])}
            />
          )}
        </div>
        <p className="text-xs text-muted mb-4">
          横＝認知度（Annictウォッチャー数・√スケール）、縦＝熱量（Xバズ volume 0〜5）。
          中央の十字が象限境界（認知は中央値、熱量は3）。
          広報・製作委員会向けの意思決定可視化です。
        </p>
        <SectionNote text={awarenessHeatComment(awarenessHeat)} />
        {awarenessHeat.length === 0 ? (
          <p className="text-sm text-muted">
            データがまだ十分に集まっていません。収集が進むと表示されます。
          </p>
        ) : (
          <AwarenessHeatScatterChart rows={awarenessHeat} />
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

/** 認知度(x, √スケール) × Xバズ熱量(y, 0〜5) の象限マップ（インラインSVG）。 */
function AwarenessHeatScatterChart({ rows }: { rows: AwarenessHeatRow[] }) {
  const W = 560;
  const H = 340;
  const PAD = { top: 20, right: 20, bottom: 40, left: 44 };
  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;

  // X軸: popularity の √スケール
  const maxPop = Math.max(1, ...rows.map((r) => r.popularity));
  const sqrtMax = Math.sqrt(maxPop);
  const px = (pop: number) =>
    PAD.left + (Math.sqrt(Math.max(0, pop)) / sqrtMax) * innerW;

  // Y軸: volume 0〜5（上が高熱量）
  const py = (vol: number) =>
    PAD.top + (1 - Math.max(0, Math.min(5, vol)) / 5) * innerH;

  // 中央値と境界線
  const pops = rows.map((r) => r.popularity).sort((a, b) => a - b);
  const mid = Math.floor(pops.length / 2);
  const popMedian =
    pops.length % 2 === 1
      ? pops[mid]
      : ((pops[mid - 1] ?? 0) + (pops[mid] ?? 0)) / 2;
  const boundX = px(popMedian);
  const boundY = py(3); // 熱量境界 = 3

  // 象限ごとの色
  const QUAD_COLOR: Record<AwarenessHeatRow["quadrant"], string> = {
    total_hit: "#e8482f",
    fan_darkhorse: "#f5a623",
    general_pr: "#2f6fdb",
    watching: "#9ca3af",
  };

  return (
    <div className="overflow-x-auto">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full min-w-[480px]"
        role="img"
        aria-label="認知度とXバズ熱量の象限散布図"
      >
        {/* 象限背景 */}
        <rect x={boundX} y={PAD.top} width={W - PAD.right - boundX} height={boundY - PAD.top}
          fill="#e8482f" fillOpacity="0.04" />
        <rect x={PAD.left} y={PAD.top} width={boundX - PAD.left} height={boundY - PAD.top}
          fill="#f5a623" fillOpacity="0.04" />
        <rect x={boundX} y={boundY} width={W - PAD.right - boundX} height={H - PAD.bottom - boundY}
          fill="#2f6fdb" fillOpacity="0.04" />
        <rect x={PAD.left} y={boundY} width={boundX - PAD.left} height={H - PAD.bottom - boundY}
          fill="#9ca3af" fillOpacity="0.04" />

        {/* 軸 */}
        <line x1={PAD.left} x2={PAD.left} y1={PAD.top} y2={H - PAD.bottom} stroke="#e8eaef" />
        <line x1={PAD.left} x2={W - PAD.right} y1={H - PAD.bottom} y2={H - PAD.bottom} stroke="#e8eaef" />

        {/* 象限境界（中央十字） */}
        <line x1={boundX} x2={boundX} y1={PAD.top} y2={H - PAD.bottom}
          stroke="#c4c8d4" strokeDasharray="4 3" strokeWidth="1" />
        <line x1={PAD.left} x2={W - PAD.right} y1={boundY} y2={boundY}
          stroke="#c4c8d4" strokeDasharray="4 3" strokeWidth="1" />

        {/* 象限ラベル注記 */}
        <text x={W - PAD.right - 4} y={PAD.top + 14} textAnchor="end" fontSize="9" fill="#e8482f" fontWeight="600">
          総合ヒット
        </text>
        <text x={PAD.left + 4} y={PAD.top + 14} textAnchor="start" fontSize="9" fill="#f5a623" fontWeight="600">
          ファン型ダークホース
        </text>
        <text x={W - PAD.right - 4} y={H - PAD.bottom - 8} textAnchor="end" fontSize="9" fill="#2f6fdb" fontWeight="600">
          一般・PR先行
        </text>
        <text x={PAD.left + 4} y={H - PAD.bottom - 8} textAnchor="start" fontSize="9" fill="#9ca3af" fontWeight="600">
          様子見
        </text>

        {/* 軸ラベル */}
        <text x={PAD.left + innerW / 2} y={H - 6} textAnchor="middle" fontSize="10" fill="#8a909c">
          認知度（Annictウォッチャー数・√スケール）→
        </text>

        {/* 点 */}
        {rows.map((r) => (
          <circle
            key={r.workId}
            cx={px(r.popularity).toFixed(1)}
            cy={py(r.volume).toFixed(1)}
            r="5"
            fill={QUAD_COLOR[r.quadrant]}
            fillOpacity="0.72"
          >
            <title>{`${r.title} ─ 認知${r.popularity.toLocaleString()} / 熱量${Math.round(r.volume * 10) / 10}/5 (${
              { total_hit: "総合ヒット", fan_darkhorse: "ファン型ダークホース", general_pr: "一般・PR先行", watching: "様子見" }[r.quadrant]
            })`}</title>
          </circle>
        ))}

        {/* Y軸目盛 */}
        {[0, 1, 2, 3, 4, 5].map((v) => (
          <text
            key={v}
            x={PAD.left - 6}
            y={py(v) + 3.5}
            textAnchor="end"
            fontSize="9"
            fill="#8a909c"
          >
            {v}
          </text>
        ))}

        {/* Y軸ラベル（縦書き代替: 回転テキスト） */}
        <text
          x={10}
          y={PAD.top + innerH / 2}
          textAnchor="middle"
          fontSize="10"
          fill="#8a909c"
          transform={`rotate(-90, 10, ${PAD.top + innerH / 2})`}
        >
          熱量（Xバズ）↑
        </text>
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
              <li key={w.workId} className="flex items-start gap-3 py-1">
                <span className={`w-5 text-right font-black tabular-nums shrink-0 ${i < 3 ? "text-accent" : "text-muted"}`}>
                  {i + 1}
                </span>
                <div className="flex-1 min-w-0">
                  <Link
                    href={`/works/${w.workId}`}
                    className="block text-sm font-medium text-ink hover:text-primary transition truncate"
                  >
                    {w.title}
                  </Link>
                  <span className="text-[0.68rem] text-muted tabular-nums">
                    熱量{w.passionDev} / 認知{w.awarenessDev}
                  </span>
                </div>
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
                  <li key={w.workId} className="flex items-start gap-3 py-2">
                    <span
                      className={`w-5 text-right font-black tabular-nums shrink-0 ${
                        i < 3 ? "text-accent" : "text-muted"
                      }`}
                    >
                      {i + 1}
                    </span>
                    <div className="flex-1 min-w-0">
                      <Link
                        href={`/analytics/works/${w.workId}`}
                        className="block text-sm font-medium text-ink hover:text-primary transition truncate"
                      >
                        {w.title}
                      </Link>
                      <span className="text-[0.68rem] text-muted tabular-nums">
                        評価{w.scoreDev!.toFixed(0)} / 認知{w.awarenessDev.toFixed(0)}
                      </span>
                    </div>
                    <span className="text-xs font-black text-emerald-600 tabular-nums shrink-0 w-10 text-right">
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
                  <li key={w.workId} className="flex items-start gap-3 py-2">
                    <span
                      className={`w-5 text-right font-black tabular-nums shrink-0 ${
                        i < 3 ? "text-accent" : "text-muted"
                      }`}
                    >
                      {i + 1}
                    </span>
                    <div className="flex-1 min-w-0">
                      <Link
                        href={`/analytics/works/${w.workId}`}
                        className="block text-sm font-medium text-ink hover:text-primary transition truncate"
                      >
                        {w.title}
                      </Link>
                      <span className="text-[0.68rem] text-muted tabular-nums">
                        認知{w.awarenessDev.toFixed(0)} / 評価{w.scoreDev!.toFixed(0)}
                      </span>
                    </div>
                    <span className="text-xs font-black text-amber-500 tabular-nums shrink-0 w-10 text-right">
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
function peopleSp(
  compare?: string,
  comparestaff?: string,
  vasort?: string,
  vadir?: string,
  stsort?: string,
  stdir?: string,
  strole?: string,
): string {
  const p = new URLSearchParams();
  p.set("view", "people");
  if (compare) p.set("compare", compare);
  if (comparestaff) p.set("comparestaff", comparestaff);
  if (vasort) p.set("vasort", vasort);
  if (vadir) p.set("vadir", vadir);
  if (stsort) p.set("stsort", stsort);
  if (stdir) p.set("stdir", stdir);
  if (strole) p.set("strole", strole);
  return p.toString();
}

/**
 * ソートリンク用 URL を生成する（列ヘッダクリック用）。
 * 同一列クリックで昇降トグル、別列クリックで降順デフォルト。
 */
function buildSortHref(
  base: URLSearchParams | string,
  sortParam: string,
  dirParam: string,
  col: string,
  currentSort: string | undefined,
  currentDir: string | undefined,
): string {
  const p = new URLSearchParams(base.toString());
  const isSameCol = currentSort === col;
  const nextDir = isSameCol && currentDir === "desc" ? "asc" : "desc";
  p.set(sortParam, col);
  p.set(dirParam, nextDir);
  return `/analytics?${p.toString()}`;
}

/** ソート列ヘッダに付ける ▲▼ インジケータ */
function SortIndicator({ col, current, dir }: { col: string; current: string | undefined; dir: string | undefined }) {
  if (current !== col) return <span className="text-line ml-0.5">↕</span>;
  return <span className="text-accent ml-0.5">{dir === "asc" ? "▲" : "▼"}</span>;
}

async function PeopleSection({
  compare,
  comparestaff,
  vasort,
  vadir,
  stsort,
  stdir,
  strole,
}: {
  compare?: string;
  comparestaff?: string;
  vasort?: string;
  vadir?: string;
  stsort?: string;
  stdir?: string;
  strole?: string;
}) {
  const [vasRaw, staffBucketsRaw] = await Promise.all([
    getVoiceActorScorecards({ limit: 30 }).catch(() => []),
    getStaffScorecards({ limit: 15 }).catch(() => []),
  ]);

  // ---- 声優スコアカード ソート ----
  const vaAsc = vadir === "asc";
  type VaKey = "appearances" | "leadRatio" | "leadAvgScore" | "battingAverage" | "momentum";
  const VA_SORT_KEYS: VaKey[] = ["appearances", "leadRatio", "leadAvgScore", "battingAverage", "momentum"];
  const vaKey = VA_SORT_KEYS.includes(vasort as VaKey) ? (vasort as VaKey) : null;
  const vas = vaKey
    ? [...vasRaw].sort((a, b) => {
        const av = a[vaKey] ?? -Infinity;
        const bv = b[vaKey] ?? -Infinity;
        return vaAsc ? (av as number) - (bv as number) : (bv as number) - (av as number);
      })
    : vasRaw;

  // ---- スタッフ実績 ソート ----
  const stAsc = stdir === "asc";
  type StKey = "works" | "avgScore" | "battingAverage";
  const ST_SORT_KEYS: StKey[] = ["works", "avgScore", "battingAverage"];
  const stKey = ST_SORT_KEYS.includes(stsort as StKey) ? (stsort as StKey) : null;
  const staffBuckets = staffBucketsRaw.map((bucket) => {
    if (!stKey || (strole && strole !== bucket.role)) return bucket;
    return {
      ...bucket,
      people: [...bucket.people].sort((a, b) => {
        const av = a[stKey] ?? -Infinity;
        const bv = b[stKey] ?? -Infinity;
        return stAsc ? (av as number) - (bv as number) : (bv as number) - (av as number);
      }),
    };
  });

  const compareNames = parseCompareNames(compare);
  const baseSp = peopleSp(compare, comparestaff, vasort, vadir, stsort, stdir, strole);

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
        <SectionNote text={vaScorecardComment(vas)} />
        {vas.length === 0 ? (
          <p className="text-sm text-muted">スコアデータが十分に集まっていません。</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm border-collapse">
              <thead>
                <tr className="text-xs text-muted border-b border-line">
                  <th className="text-left font-bold py-2 pr-2 w-6">#</th>
                  <th className="text-left font-bold py-2 pr-3">声優</th>
                  <th className="text-center font-bold py-2 px-1 w-12">
                    <Link href={buildSortHref(new URLSearchParams(baseSp), "vasort", "vadir", "appearances", vasort, vadir)} className="hover:text-ink transition inline-flex items-center gap-0.5">
                      出演<SortIndicator col="appearances" current={vasort} dir={vadir} />
                    </Link>
                  </th>
                  <th className="text-center font-bold py-2 px-1 w-14">
                    <Link href={buildSortHref(new URLSearchParams(baseSp), "vasort", "vadir", "leadRatio", vasort, vadir)} className="hover:text-ink transition inline-flex items-center gap-0.5">
                      主演率<SortIndicator col="leadRatio" current={vasort} dir={vadir} />
                    </Link>
                  </th>
                  <th className="text-center font-bold py-2 px-1 w-20">
                    <Link href={buildSortHref(new URLSearchParams(baseSp), "vasort", "vadir", "leadAvgScore", vasort, vadir)} className="hover:text-ink transition inline-flex items-center gap-0.5">
                      主演作平均<SortIndicator col="leadAvgScore" current={vasort} dir={vadir} />
                    </Link>
                  </th>
                  <th className="text-center font-bold py-2 px-1 w-14">
                    <Link href={buildSortHref(new URLSearchParams(baseSp), "vasort", "vadir", "battingAverage", vasort, vadir)} className="hover:text-ink transition inline-flex items-center gap-0.5">
                      打率<SortIndicator col="battingAverage" current={vasort} dir={vadir} />
                    </Link>
                  </th>
                  <th className="text-center font-bold py-2 px-1 w-20">
                    <Link href={buildSortHref(new URLSearchParams(baseSp), "vasort", "vadir", "momentum", vasort, vadir)} className="hover:text-ink transition inline-flex items-center gap-0.5">
                      モメンタム<SortIndicator col="momentum" current={vasort} dir={vadir} />
                    </Link>
                  </th>
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
            stsort={bucket.role === strole ? stsort : undefined}
            stdir={bucket.role === strole ? stdir : undefined}
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
        <Link
          href={`/analytics/people/va/${encodeURIComponent(v.name)}`}
          className="font-medium text-ink hover:text-primary transition line-clamp-1"
        >
          {v.name}
        </Link>
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
  stsort,
  stdir,
}: {
  label: string;
  roleKey: string;
  people: StaffScorecard[];
  staffCompareNames: string[];
  comparestaff: string | undefined;
  baseSp: string;
  stsort?: string;
  stdir?: string;
}) {
  // スタッフソートリンクは role を strole に付加してビルド
  function stSortHref(col: string): string {
    const p = new URLSearchParams(baseSp);
    const isSame = stsort === col;
    const nextDir = isSame && stdir === "desc" ? "asc" : "desc";
    p.set("stsort", col);
    p.set("stdir", nextDir);
    p.set("strole", roleKey);
    return `/analytics?${p.toString()}`;
  }
  return (
    <section className="card p-5 sm:p-6">
      <h2 className="section-title text-base mb-3">{label}</h2>
      {people.length === 0 ? (
        <p className="text-sm text-muted">データがありません。</p>
      ) : (
        <>
          <SectionNote text={staffBucketComment(people)} />
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
            <table className="w-full min-w-[300px] text-sm border-collapse">
              <thead>
                <tr className="text-[0.68rem] text-muted border-b border-line">
                  <th className="text-left font-bold py-1.5 pr-2">名前</th>
                  <th className="text-center font-bold py-1.5 px-1 w-8">
                    <Link href={stSortHref("works")} className="hover:text-ink transition inline-flex items-center gap-0.5">
                      本<SortIndicator col="works" current={stsort} dir={stdir} />
                    </Link>
                  </th>
                  <th className="text-center font-bold py-1.5 px-1 w-10">
                    <Link href={stSortHref("avgScore")} className="hover:text-ink transition inline-flex items-center gap-0.5">
                      平均<SortIndicator col="avgScore" current={stsort} dir={stdir} />
                    </Link>
                  </th>
                  <th className="text-center font-bold py-1.5 px-1 w-10">
                    <Link href={stSortHref("battingAverage")} className="hover:text-ink transition inline-flex items-center gap-0.5">
                      打率<SortIndicator col="battingAverage" current={stsort} dir={stdir} />
                    </Link>
                  </th>
                  <th className="text-left font-bold py-1.5 pl-2 w-16">直近</th>
                  <th className="text-center font-bold py-1.5 pl-1 w-10">比較</th>
                </tr>
              </thead>
              <tbody>
                {people.map((p) => {
                  const inCompare = staffCompareNames.includes(p.name);
                  const staffHref = buildStaffCompareHref(comparestaff, roleKey, p.name, baseSp);
                  return (
                    <tr
                      key={p.name}
                      className={`border-b border-line/60 hover:bg-paper/60 ${inCompare ? "bg-surface" : ""}`}
                    >
                      <td className="py-1.5 pr-2 max-w-[120px]">
                        <Link
                          href={`/analytics/people/staff/${encodeURIComponent(p.name)}`}
                          className="font-medium text-ink hover:text-primary transition text-xs break-words leading-tight"
                        >
                          {p.name}
                        </Link>
                      </td>
                      <td className="py-1.5 px-1 text-center tabular-nums text-xs text-ink-soft">
                        {p.works}
                      </td>
                      <td className="py-1.5 px-1 text-center tabular-nums font-black text-accent text-xs">
                        {Math.round(p.avgScore)}
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
  const [coverage, jobs, gaps, syncRuns] = await Promise.all([
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
    getAllSyncRuns(30).catch(() => [] as SyncRunRow[]),
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

      {/* 自動アクションの実行履歴 */}
      <section className="card p-5 sm:p-6">
        <h2 className="section-title text-lg mb-1">自動アクションの実行履歴</h2>
        <p className="text-xs text-muted mb-4">
          全バックグラウンドジョブの直近30件の実行記録。種別・時刻(JST)・状態・件数・概要を一覧表示します。
        </p>
        {syncRuns.length === 0 ? (
          <p className="text-sm text-muted">実行記録がまだありません。</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm border-collapse">
              <thead>
                <tr className="text-xs text-muted border-b border-line">
                  <th className="text-left font-bold py-2 pr-3 w-32">実行時刻</th>
                  <th className="text-left font-bold py-2 pr-3">種別</th>
                  <th className="text-center font-bold py-2 px-1 w-16">状態</th>
                  <th className="text-center font-bold py-2 px-1 w-14">作成</th>
                  <th className="text-center font-bold py-2 px-1 w-14">更新</th>
                  <th className="text-center font-bold py-2 px-1 w-14">エラー</th>
                  <th className="text-left font-bold py-2 pl-2">概要</th>
                </tr>
              </thead>
              <tbody>
                {syncRuns.map((r) => (
                  <tr key={r.id} className="border-b border-line/60 hover:bg-paper/60">
                    <td className="py-2 pr-3 text-xs text-ink-soft tabular-nums whitespace-nowrap">
                      {r.finishedAt ? formatAirShort(r.finishedAt) : r.startedAt ? formatAirShort(r.startedAt) : "—"}
                    </td>
                    <td className="py-2 pr-3 text-xs font-medium text-ink whitespace-nowrap">
                      {r.jobLabel}
                    </td>
                    <td className="py-2 px-1 text-center">
                      <SyncStatusChip status={r.status} />
                    </td>
                    <td className="py-2 px-1 text-center tabular-nums text-xs text-ink-soft">
                      {r.created > 0 ? r.created.toLocaleString() : "—"}
                    </td>
                    <td className="py-2 px-1 text-center tabular-nums text-xs text-ink-soft">
                      {r.updated > 0 ? r.updated.toLocaleString() : "—"}
                    </td>
                    <td className={`py-2 px-1 text-center tabular-nums text-xs font-bold ${r.errors > 0 ? "text-accent" : "text-muted"}`}>
                      {r.errors > 0 ? r.errors.toLocaleString() : "—"}
                    </td>
                    <td className="py-2 pl-2 text-xs text-muted truncate max-w-[220px]" title={r.note ?? undefined}>
                      {r.note ? r.note.slice(0, 80) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* 自動更新スケジュール（各cronの実行頻度メモ） */}
      <UpdateScheduleCard />

      <p className="text-xs text-muted leading-relaxed">
        ※ 収集は個人運営の過去ログAPIへ配慮し、1番組ずつ間隔を空けて取得しています。
        放送直後はAPIへの反映に時間がかかるため、45分のバッファを置いてから収集を開始します。
      </p>
    </div>
  );
}

/** 各バックグラウンド処理(GitHub Actions cron)の実行頻度。時刻はすべて日本時間(JST)。 */
const UPDATE_SCHEDULE: { task: string; cadence: string; detail: string }[] = [
  { task: "番組表・作品データ取込", cadence: "1日2回 6:00 / 18:00", detail: "Annictから番組・作品・話数を同期" },
  { task: "ポスター・人気度の補完", cadence: "1日2回 6:30 / 18:30", detail: "AniListポスター＋Annict watchers を更新" },
  { task: "作品スコア統計", cadence: "毎日 5:30", detail: "Annictの視聴ステータス集計を更新" },
  { task: "ニコニコ実況コメント収集", cadence: "毎時 15分", detail: "放送終了45分後〜を順次収集・分単位で分析" },
  { task: "分析スナップショット再計算", cadence: "30分おき", detail: "ハブ／作品分析を事前計算しページを高速化" },
  { task: "Xバズ収集", cadence: "3時間おき", detail: "Grok x_search で作品・話数の反応と実ポストを蓄積" },
  { task: "サイト再デプロイ", cadence: "mainへの反映時", detail: "コード更新をCloudflareへ自動公開" },
];

function UpdateScheduleCard() {
  return (
    <section className="card p-5 sm:p-6">
      <h2 className="section-title text-lg mb-1">自動更新スケジュール</h2>
      <p className="text-xs text-muted mb-4">
        各データはバックグラウンドで定期的に自動更新されています（時刻は日本時間）。
      </p>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[480px] text-sm border-collapse">
          <thead>
            <tr className="text-xs text-muted border-b border-line">
              <th className="text-left font-bold py-2 pr-3">処理</th>
              <th className="text-left font-bold py-2 px-2 w-40">頻度</th>
              <th className="text-left font-bold py-2 pl-2">内容</th>
            </tr>
          </thead>
          <tbody>
            {UPDATE_SCHEDULE.map((s) => (
              <tr key={s.task} className="border-b border-line/60">
                <td className="py-2 pr-3 font-medium text-ink whitespace-nowrap">{s.task}</td>
                <td className="py-2 px-2 text-ink-soft tabular-nums whitespace-nowrap">{s.cadence}</td>
                <td className="py-2 pl-2 text-xs text-muted">{s.detail}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function SyncStatusChip({ status }: { status: string | null }) {
  const cls =
    status === "ok"
      ? "bg-emerald-100 text-emerald-700"
      : status === "partial"
        ? "bg-amber-100 text-amber-700"
        : status === "error"
          ? "bg-rose-100 text-rose-700"
          : "bg-paper text-muted border border-line";
  return (
    <span className={`inline-block text-[0.66rem] font-bold px-2 py-0.5 rounded-full whitespace-nowrap ${cls}`}>
      {status ?? "—"}
    </span>
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

async function IndustrySection({
  period,
  scsort,
  scdir,
  gsort,
  gdir,
}: {
  period?: string;
  scsort?: string;
  scdir?: string;
  gsort?: string;
  gdir?: string;
}) {
  const curYear = new Date().getFullYear();
  const { filter, label, key } = parsePeriod(period, curYear);

  const [volumeAll, scorecardsRaw, vas, popular, topAni, topMal, genreInsightsRaw, franchises, globalGap, sequelProspect] = await Promise.all([
    getSeasonVolume().catch((): SeasonVolume[] => []),
    getStudioScorecards({ limit: 20 }).catch((): StudioScorecard[] => []),
    getVaRanking(filter, 24).catch((): VaStat[] => []),
    getPopular(filter, 12).catch((): RatedWork[] => []),
    getTopRated(filter, "anilist", 12).catch((): RatedWork[] => []),
    getTopRated(filter, "mal", 12).catch((): RatedWork[] => []),
    getGenreInsights().catch(() => [] as GenreInsight[]),
    getFranchiseMomentum().catch(() => [] as FranchiseGroup[]),
    getGlobalGap(30).catch((): GlobalGapRow[] => []),
    getSequelProspect(30).catch((): SequelProspectRow[] => []),
  ]);

  // ---- 制作会社スコアカード ソート ----
  type ScKey = "worksCount" | "avgScore" | "battingAverage" | "consistency";
  const SC_SORT_KEYS: ScKey[] = ["worksCount", "avgScore", "battingAverage", "consistency"];
  const scKey = SC_SORT_KEYS.includes(scsort as ScKey) ? (scsort as ScKey) : null;
  const scAsc = scdir === "asc";
  const scorecards = scKey
    ? [...scorecardsRaw].sort((a, b) => {
        const av = a[scKey] ?? -Infinity;
        const bv = b[scKey] ?? -Infinity;
        return scAsc ? (av as number) - (bv as number) : (bv as number) - (av as number);
      })
    : scorecardsRaw;

  // ---- ジャンル動向 ソート ----
  type GKey = "worksCount" | "avgPopularity" | "avgScore";
  const G_SORT_KEYS: GKey[] = ["worksCount", "avgPopularity", "avgScore"];
  const gKey = G_SORT_KEYS.includes(gsort as GKey) ? (gsort as GKey) : null;
  const gAsc = gdir === "asc";
  const genreInsights = gKey
    ? [...genreInsightsRaw].sort((a, b) => {
        const av = a[gKey] ?? -Infinity;
        const bv = b[gKey] ?? -Infinity;
        return gAsc ? (av as number) - (bv as number) : (bv as number) - (av as number);
      })
    : genreInsightsRaw;

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
            className={`text-xs font-medium px-3 py-1.5 rounded-full transition ${
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
      <StudioScorecardCard scorecards={scorecards} scsort={scsort} scdir={scdir} period={period} />

      {/* 高評価ランキング */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <section className="card p-5 sm:p-6">
          <h2 className="section-title text-lg mb-1">高評価ランキング（AniList）</h2>
          <p className="text-xs text-muted mb-4">海外ユーザー評価・100点満点</p>
          <SectionNote text={ratedRankingComment(topAni, "anilist")} />
          <RatedList works={topAni} metric="anilist" />
        </section>
        <section className="card p-5 sm:p-6">
          <h2 className="section-title text-lg mb-1">高評価ランキング（MyAnimeList）</h2>
          <p className="text-xs text-muted mb-4">世界最大級のDB・10点満点</p>
          <SectionNote text={ratedRankingComment(topMal, "mal")} />
          <RatedList works={topMal} metric="mal" />
        </section>
      </div>

      {/* 人気作品 */}
      <section className="card p-5 sm:p-6">
        <h2 className="section-title text-lg mb-1">人気作品ランキング</h2>
        <p className="text-xs text-muted mb-4">Annictウォッチャー数（国内人気）</p>
        <SectionNote text={popularRankingComment(popular)} />
        <RankGrid works={popular} metric="popularity" />
      </section>

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
      <GenreTrendsCard insights={genreInsights} gsort={gsort} gdir={gdir} period={period} />

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

      {/* 国内 × 海外 人気乖離 */}
      {globalGap.length > 0 && (
        <GlobalGapCard rows={globalGap} />
      )}

      {/* 続編可能性スコア（参考） */}
      <SequelProspectCard rows={sequelProspect} />

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

function StudioScorecardCard({
  scorecards,
  scsort,
  scdir,
  period,
}: {
  scorecards: StudioScorecard[];
  scsort?: string;
  scdir?: string;
  period?: string;
}) {
  function scSortHref(col: string): string {
    const p = new URLSearchParams();
    p.set("view", "industry");
    if (period) p.set("period", period);
    const isSame = scsort === col;
    const nextDir = isSame && scdir === "desc" ? "asc" : "desc";
    p.set("scsort", col);
    p.set("scdir", nextDir);
    return `/analytics?${p.toString()}`;
  }
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
      <SectionNote text={studioBucketComment(scorecards)} />
      {scorecards.length === 0 ? (
        <p className="text-sm text-muted">スコアデータが十分に集まっていません。</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm border-collapse">
            <thead>
              <tr className="text-xs text-muted border-b border-line">
                <th className="text-left font-bold py-2 pr-2 w-6">#</th>
                <th className="text-left font-bold py-2 pr-3">制作会社</th>
                <th className="text-center font-bold py-2 px-1 w-14">
                  <Link href={scSortHref("worksCount")} className="hover:text-ink transition inline-flex items-center gap-0.5">
                    制作数<SortIndicator col="worksCount" current={scsort} dir={scdir} />
                  </Link>
                </th>
                <th className="text-center font-bold py-2 px-1 w-16">
                  <Link href={scSortHref("avgScore")} className="hover:text-ink transition inline-flex items-center gap-0.5">
                    平均スコア<SortIndicator col="avgScore" current={scsort} dir={scdir} />
                  </Link>
                </th>
                <th className="text-left font-bold py-2 px-2 w-32">
                  <Link href={scSortHref("battingAverage")} className="hover:text-ink transition inline-flex items-center gap-0.5">
                    打率<SortIndicator col="battingAverage" current={scsort} dir={scdir} />
                  </Link>
                </th>
                <th className="text-center font-bold py-2 px-1 w-14">
                  <Link href={scSortHref("consistency")} className="hover:text-ink transition inline-flex items-center gap-0.5">
                    一貫性<SortIndicator col="consistency" current={scsort} dir={scdir} />
                  </Link>
                </th>
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

function GenreTrendsCard({
  insights,
  gsort,
  gdir,
  period,
}: {
  insights: GenreInsight[];
  gsort?: string;
  gdir?: string;
  period?: string;
}) {
  const top = insights.slice(0, 24);

  function gSortHref(col: string): string {
    const p = new URLSearchParams();
    p.set("view", "industry");
    if (period) p.set("period", period);
    const isSame = gsort === col;
    const nextDir = isSame && gdir === "desc" ? "asc" : "desc";
    p.set("gsort", col);
    p.set("gdir", nextDir);
    return `/analytics?${p.toString()}`;
  }

  return (
    <section className="card p-5 sm:p-6">
      <h2 className="section-title text-lg mb-1">ジャンル動向</h2>
      <p className="text-xs text-muted mb-4">
        AniList ジャンルタグ別の作品数・平均人気・平均スコア（上位24ジャンル）。
        スコアは AniList 優先、なければ MAL 換算。データは12時間ごとに補完されます。
      </p>
      <SectionNote text={genreTrendsComment(insights)} />
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
                <th className="text-center font-bold py-2 px-2 w-16">
                  <Link href={gSortHref("worksCount")} className="hover:text-ink transition inline-flex items-center gap-0.5">
                    作品数<SortIndicator col="worksCount" current={gsort} dir={gdir} />
                  </Link>
                </th>
                <th className="text-center font-bold py-2 px-2 w-24">
                  <Link href={gSortHref("avgPopularity")} className="hover:text-ink transition inline-flex items-center gap-0.5">
                    平均人気<SortIndicator col="avgPopularity" current={gsort} dir={gdir} />
                  </Link>
                </th>
                <th className="text-center font-bold py-2 px-2 w-20">
                  <Link href={gSortHref("avgScore")} className="hover:text-ink transition inline-flex items-center gap-0.5">
                    平均スコア<SortIndicator col="avgScore" current={gsort} dir={gdir} />
                  </Link>
                </th>
              </tr>
            </thead>
            <tbody>
              {top.map((g) => (
                <tr key={g.genre} className="border-b border-line/60 hover:bg-paper/60">
                  <td className="py-2 pr-3 font-medium text-ink">{genreJa(g.genre)}</td>
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
                    {`${genreJa(p.g.genre)}: 需要${p.demand} / 供給${p.supply}（平均人気${p.g.avgPopularity.toLocaleString()}・${p.g.worksCount}本）`}
                  </title>
                </circle>
                <text x={cx + 7} y={cy + 3} fontSize="10" fill="#5a616e">
                  {genreJa(p.g.genre)}
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
            <li key={p.g.genre} className="flex items-start gap-3 py-2">
              <span className={`w-5 text-right font-black tabular-nums shrink-0 ${i < 3 ? "text-accent" : "text-muted"}`}>
                {i + 1}
              </span>
              <div className="flex-1 min-w-0">
                <span className="block text-sm font-medium text-ink truncate">{genreJa(p.g.genre)}</span>
                <span className="block text-[0.68rem] text-muted tabular-nums">
                  人気{p.g.avgPopularity.toLocaleString()} / {p.g.worksCount}本
                  {p.g.avgScore != null ? ` / スコア${p.g.avgScore.toFixed(1)}` : ""}
                </span>
              </div>
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

/* ================================================================ 国内 × 海外 人気乖離 */

/** kind → タグの表示ラベルとスタイル。 */
const GAP_KIND_STYLE: Record<GlobalGapKind, { label: string; cls: string }> = {
  overseas_lead: { label: "海外先行", cls: "bg-blue-100 text-blue-700" },
  domestic_lead: { label: "国内先行", cls: "bg-amber-100 text-amber-700" },
  balanced: { label: "均衡", cls: "bg-paper text-muted border border-line" },
};

/**
 * 国内 × 海外 人気乖離カード。
 * 各作品を「国内 ▮▮▮ / 海外 ▮▮▮（gap ±N）」の 2 本横バー＋kind タグで表示する。
 * ポスター・作品ページへのリンク・CSV エクスポートに対応。
 */
function GlobalGapCard({ rows }: { rows: GlobalGapRow[] }) {
  const comment = globalGapComment(rows);

  const csvHeaders = ["順位", "作品", "国内スコア", "海外スコア", "乖離(gap)", "判定"];
  const csvRows = rows.map((r, i) => [
    i + 1,
    r.title,
    r.domestic,
    r.overseas,
    r.gap,
    GAP_KIND_STYLE[r.kind].label,
  ] as (string | number)[]);

  return (
    <section className="card p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3 mb-1">
        <h2 className="section-title text-lg">国内 × 海外 人気乖離（今期）</h2>
        <CsvExportButton filename="国内海外乖離.csv" headers={csvHeaders} rows={csvRows} />
      </div>
      <p className="text-xs text-muted mb-1">
        国内人気（Annictウォッチャー数）と海外人気（AniList利用者数、なければMAL登録数）をコホート内パーセンタイル(0〜100)に正規化し、
        乖離（海外 − 国内）を可視化。製作委員会・ライセンス担当向け。
      </p>
      <p className="text-[0.68rem] text-muted mb-4 leading-relaxed">
        |乖離| ≥ 20 を「先行」と判定。海外先行 = 海外配信・ライセンス強化の余地。国内先行 = 海外PR・字幕配信の先行投資機会。
      </p>
      <SectionNote text={comment} />
      <ol className="divide-y divide-line">
        {rows.map((row, i) => {
          const { label, cls } = GAP_KIND_STYLE[row.kind];
          const gapSign = row.gap >= 0 ? `+${row.gap}` : `${row.gap}`;
          const gapColor =
            row.kind === "overseas_lead"
              ? "text-blue-600"
              : row.kind === "domestic_lead"
                ? "text-amber-600"
                : "text-muted";
          return (
            <li key={row.workId} className="flex items-start gap-3 py-2.5">
              <span
                className={`w-6 text-center font-black tabular-nums shrink-0 mt-1 ${
                  i < 3 ? "text-accent" : "text-muted"
                }`}
              >
                {i + 1}
              </span>
              <Link href={`/analytics/works/${row.workId}`} className="shrink-0">
                <WorkCover
                  id={row.workId}
                  title={row.title}
                  url={row.posterUrl}
                  className="w-9 h-12 rounded-md"
                />
              </Link>
              <div className="min-w-0 flex-1">
                <Link
                  href={`/analytics/works/${row.workId}`}
                  className="block text-sm font-bold text-ink hover:text-primary transition truncate mb-1"
                >
                  {row.title}
                </Link>
                {/* 2本横バー: 国内（amber） / 海外（blue） */}
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="text-[0.6rem] text-muted w-7 shrink-0 text-right">国内</span>
                    <div className="flex-1 bg-paper rounded-full h-2 min-w-0">
                      <div
                        className="h-2 rounded-full bg-amber-400"
                        style={{ width: `${row.domestic}%` }}
                      />
                    </div>
                    <span className="text-[0.6rem] tabular-nums text-amber-600 font-bold w-6 shrink-0 text-right">
                      {row.domestic}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-[0.6rem] text-muted w-7 shrink-0 text-right">海外</span>
                    <div className="flex-1 bg-paper rounded-full h-2 min-w-0">
                      <div
                        className="h-2 rounded-full bg-blue-400"
                        style={{ width: `${row.overseas}%` }}
                      />
                    </div>
                    <span className="text-[0.6rem] tabular-nums text-blue-600 font-bold w-6 shrink-0 text-right">
                      {row.overseas}
                    </span>
                  </div>
                </div>
              </div>
              <div className="shrink-0 flex flex-col items-end gap-1">
                <span className={`text-sm font-black tabular-nums ${gapColor}`}>{gapSign}pt</span>
                <span
                  className={`inline-block text-[0.62rem] font-bold px-2 py-0.5 rounded-full whitespace-nowrap ${cls}`}
                >
                  {label}
                </span>
              </div>
            </li>
          );
        })}
      </ol>
      <p className="text-[0.68rem] text-muted mt-3 leading-relaxed">
        ※ 国内人気＝Annictウォッチャー数（日本）、海外人気＝AniList利用者数（主）・MAL登録数（副）。各サービス利用者を母数とした参考値。
      </p>
    </section>
  );
}

/* ================================================================ 続編可能性スコア */

/** 信号機アイコン（●） */
function SignalDot({ signal }: { signal: SequelSignal }) {
  const cls =
    signal === "green"
      ? "bg-emerald-500"
      : signal === "yellow"
        ? "bg-amber-400"
        : "bg-rose-500";
  const label =
    signal === "green" ? "続編期待大" : signal === "yellow" ? "条件次第" : "現状は厳しい";
  return (
    <span
      className={`inline-block w-3 h-3 rounded-full shrink-0 ${cls}`}
      title={label}
      aria-label={label}
    />
  );
}

/**
 * 続編可能性スコアカード（業界データタブ・製作委員会/出版社向け参考指標）。
 * green/yellow/red の信号機と score 降順リストを表示。
 */
function SequelProspectCard({ rows }: { rows: SequelProspectRow[] }) {
  const comment = sequelProspectComment(rows);

  const csvHeaders = ["順位", "作品名", "スコア", "信号機", "継続率(%)", "人気%ile", "X volume"];
  const csvRows = rows.map((r, i) => [
    i + 1,
    r.title,
    r.score,
    r.signal === "green" ? "続編期待大" : r.signal === "yellow" ? "条件次第" : "現状は厳しい",
    r.retentionPct ?? "",
    r.popularityPctl ?? "",
    r.xVolume ?? "",
  ] as (string | number)[]);

  return (
    <section className="card p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3 mb-1">
        <h2 className="section-title text-lg">続編可能性スコア（参考）</h2>
        {rows.length > 0 && (
          <CsvExportButton filename="sequel_prospect.csv" headers={csvHeaders} rows={csvRows} />
        )}
      </div>
      <p className="text-xs text-muted mb-1">
        実況残留率・AniList/MALスコア・Annictウォッチャー数・Xバズ・AniList海外人気の
        5シグナルをコホート内パーセンタイルで正規化し加重平均したスコア(0〜100)。
        欠測シグナルは残り重みで自動再正規化。今期の非 movie 作品が対象。
      </p>
      <p className="text-[0.68rem] text-muted mb-1 leading-relaxed">
        重み: 継続力 30% ・ 質の代理(スコア) 20% ・ 人気規模 25% ・ 社会的熱量(X) 15% ・ 海外需要 10%
      </p>
      <p className="text-[0.68rem] text-muted mb-1 leading-relaxed">
        信号機:
        <span className="inline-flex items-center gap-1 mx-1">
          <span className="inline-block w-2.5 h-2.5 rounded-full bg-emerald-500" />
          <span>緑(≥66): 続編期待大</span>
        </span>
        /
        <span className="inline-flex items-center gap-1 mx-1">
          <span className="inline-block w-2.5 h-2.5 rounded-full bg-amber-400" />
          <span>黄(40〜65): 条件次第</span>
        </span>
        /
        <span className="inline-flex items-center gap-1 mx-1">
          <span className="inline-block w-2.5 h-2.5 rounded-full bg-rose-500" />
          <span>赤(&lt;40): 現状は厳しい</span>
        </span>
      </p>
      <p className="text-[0.7rem] font-bold text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-3 py-2 mb-4 leading-relaxed">
        ⚠ BD/配信売上・グッズ売上・製作委員会の内部事情・原作者の意向などは一切含みません。
        公開データ（視聴継続・スコア・人気・Xバズ）のみによる参考スコアです。
        実際の続編可否はこのスコアとは無関係に決定されます。
      </p>
      <SectionNote text={comment} />
      {rows.length === 0 ? (
        <p className="text-sm text-muted">データが集まっていません。今期データが揃うと表示されます。</p>
      ) : (
        <ol className="divide-y divide-line">
          {rows.slice(0, 20).map((row, i) => (
            <li key={row.workId} className="flex items-start gap-3 py-2.5">
              <span
                className={`w-6 text-center font-black tabular-nums shrink-0 mt-1 ${
                  i < 3 ? "text-accent" : "text-muted"
                }`}
              >
                {i + 1}
              </span>
              {/* 信号機 */}
              <div className="shrink-0 flex items-start mt-1.5">
                <SignalDot signal={row.signal} />
              </div>
              <Link href={`/analytics/works/${row.workId}`} className="shrink-0">
                <WorkCover
                  id={row.workId}
                  title={row.title}
                  url={row.posterUrl}
                  className="w-9 h-12 rounded-md"
                />
              </Link>
              <div className="min-w-0 flex-1">
                <Link
                  href={`/analytics/works/${row.workId}`}
                  className="block text-sm font-bold text-ink hover:text-primary transition truncate"
                >
                  {row.title}
                </Link>
                {/* 3シグナルの細バー */}
                <div className="mt-1 grid grid-cols-3 gap-x-2 gap-y-0.5 max-w-[260px]">
                  {(
                    [
                      { label: "継続率", value: row.retentionPct, max: 100, color: "#2ebd85" },
                      { label: "人気", value: row.popularityPctl, max: 100, color: "#2f6fdb" },
                      { label: "X", value: row.xVolume != null ? (row.xVolume / 5) * 100 : null, max: 100, color: "#f5a623" },
                    ] as { label: string; value: number | null; max: number; color: string }[]
                  ).map(({ label, value, color }) => (
                    <div key={label}>
                      <div className="text-[0.55rem] text-muted leading-none mb-0.5">{label}</div>
                      <div className="h-1.5 rounded-full bg-line overflow-hidden">
                        {value != null ? (
                          <div
                            className="h-full rounded-full"
                            style={{ width: `${Math.min(100, value)}%`, backgroundColor: color }}
                          />
                        ) : (
                          <div className="h-full rounded-full bg-line" style={{ width: "0%" }} />
                        )}
                      </div>
                      <div className="text-[0.55rem] text-muted tabular-nums mt-0.5 text-right">
                        {label === "X"
                          ? row.xVolume != null
                            ? `${Math.round(row.xVolume * 10) / 10}/5`
                            : "—"
                          : value != null
                            ? Math.round(value)
                            : "—"}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              <div className="shrink-0 text-right min-w-[3rem]">
                <span className="block font-black text-accent tabular-nums text-base">
                  {row.score.toFixed(0)}
                </span>
                <span className="block text-[0.62rem] text-muted">pts</span>
              </div>
            </li>
          ))}
        </ol>
      )}
      <p className="text-[0.68rem] text-muted mt-3 leading-relaxed">
        ※ BD/配信売上・グッズ・委員会事情は含まない、公開データからの参考スコアです。
        スコアはAniList/MAL・Annict・ニコニコ実況・X各サービス利用者を母数とした推定値。
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
          <span className="w-28 sm:w-40 lg:w-56 truncate text-sm font-medium shrink-0">{r.label}</span>
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
