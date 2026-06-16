// No cookies or headers are read on this page — only params (work id).
// Switching from force-dynamic to ISR: Workers serves cached HTML per work id,
// regenerated every 30 minutes so data stays reasonably fresh without a DB hit on every request.
export const revalidate = 1800;
import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getWorkAnalysis } from "@/lib/analytics/viewing";
import { getCohortReactionAverage } from "@/lib/analytics/reactionFingerprint";
import { getWorkCohortPosition } from "@/lib/analytics/scorecard";
import { WorkAnalysisSections } from "@/components/charts/WorkAnalysisSections";
import { CohortPositionPanel } from "@/components/charts/CohortPositionPanel";
import { XBuzzSection } from "@/components/charts/XBuzzSection";
import { getWorkXBuzz, getWorkXPosts } from "@/lib/analytics/xbuzz";
import { WorkCover } from "@/components/WorkCover";
import { buildEpisodeTriple } from "@/lib/analytics/episodeTriple";
import { EpisodeTripleChart } from "@/components/charts/EpisodeTripleChart";
import { getOverallRanking } from "@/lib/analytics/overallRanking";
import { getFastStart } from "@/lib/analytics/fastStart";
import { WorkKpiStrip } from "@/components/charts/WorkKpiStrip";
import { SectionNote } from "@/components/charts/WorkAnalysisSections";
import { scoreReason } from "@/lib/analytics/sectionComments";
import { getAiCommentHistory } from "@/lib/analytics/aiComments";
import { AiCommentStepper } from "@/components/charts/AiCommentStepper";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const analysis = await getWorkAnalysis(id).catch(() => null);
  return { title: analysis ? `${analysis.title}の視聴分析` : "作品分析" };
}

export default async function WorkAnalyticsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  // 各データを並列取得（互いに依存しない）。各々のフォールバックは従来どおり。
  const [analysis, cohort, cohortReaction, xbuzz, xposts, overallRanking, fastStartRanking, workAiHistory] =
    await Promise.all([
      getWorkAnalysis(id).catch(() => null),
      getWorkCohortPosition(id).catch(() => null),
      // クール平均リアクション（レーダー比較用）。取得失敗時は undefined
      getCohortReactionAverage()
        .then((r) => r.shares)
        .catch(() => undefined),
      // X(Twitter) バズ（Grok x_search 分析）。未蓄積・失敗は null
      getWorkXBuzz(id).catch(() => null),
      // X 実ポストのサンプル。未蓄積・失敗は []
      getWorkXPosts(id).catch(() => []),
      // 総合ランキング（KPI カード用）。失敗時は []
      getOverallRanking().catch((): import("@/lib/analytics/overallRanking").OverallRanking => []),
      // 初速ランキング（KPI カード用）。失敗時は []
      getFastStart().catch((): import("@/lib/analytics/fastStart").FastStartRow[] => []),
      // 作品別AIコメント履歴。失敗・未蓄積は []
      getAiCommentHistory("work", id, 10).catch(() => []),
    ]);
  if (!analysis) notFound();

  // この作品の行を抽出（見つからなければ null）
  const overallRow = overallRanking.find((r) => r.workId === id) ?? null;
  const fastStartRow = fastStartRanking.find((r) => r.workId === id) ?? null;
  // ランキング内順位は配列がスコア降順で返ってくるので indexOf + 1
  const overallRank = overallRow != null ? overallRanking.indexOf(overallRow) + 1 : null;
  const overallTotal = overallRanking.length > 0 ? overallRanking.length : null;
  const fastStartRank = fastStartRow != null ? fastStartRanking.indexOf(fastStartRow) + 1 : null;
  const fastStartTotal = fastStartRanking.length > 0 ? fastStartRanking.length : null;

  return (
    <div className="mx-auto max-w-6xl px-4 sm:px-6">
      {/* パンくず */}
      <div className="pt-4 text-xs text-muted">
        <Link href="/analytics" className="hover:text-primary">
          アニメ分析
        </Link>
        <span className="mx-1.5">›</span>
        <span className="text-ink-soft">{analysis.title}</span>
      </div>

      {/* ヘッダー */}
      <header className="card mt-3 p-4 sm:p-5 flex items-start gap-4 sm:gap-5">
        <Link href={`/works/${analysis.workId}`} className="shrink-0">
          <WorkCover
            id={analysis.workId}
            title={analysis.title}
            url={analysis.posterUrl}
            className="w-16 h-22 sm:w-20 sm:h-28 rounded-lg"
          />
        </Link>
        <div className="min-w-0">
          <p className="text-xs font-bold text-accent">作品別 視聴分析</p>
          <h1 className="text-xl sm:text-2xl font-black leading-snug mt-1 break-words">{analysis.title}</h1>
          <div className="flex flex-wrap gap-3 mt-1.5">
            <Link
              href={`/works/${analysis.workId}`}
              className="text-xs font-bold text-primary hover:underline underline-offset-2"
            >
              作品ページへ →
            </Link>
            <Link
              href={`/analytics/compare?ids=${analysis.workId}`}
              className="text-xs font-bold text-accent hover:underline underline-offset-2"
            >
              他作品と比較 →
            </Link>
          </div>
        </div>
      </header>

      {/* KPI カードストリップ — 主要 6 指標を一目で把握 */}
      <div className="mt-3">
        <WorkKpiStrip
          analysis={analysis}
          cohort={cohort}
          xbuzz={xbuzz}
          overallRow={overallRow}
          fastStartRow={fastStartRow}
          overallRank={overallRank}
          overallTotal={overallTotal}
          fastStartRank={fastStartRank}
          fastStartTotal={fastStartTotal}
        />
        {/* スコアの根拠説明（ルールベース）— データが薄い作品では非表示 */}
        <div className="mt-2">
          <SectionNote text={scoreReason(overallRow)} />
        </div>
      </div>

      <div className="space-y-5 py-5">
        {/* AIの所感（作品の声）。履歴が2件以上あればステッパーで過去も辿れる。 */}
        {(workAiHistory.length > 0 || xbuzz?.summary) && (() => {
          // 履歴優先、なければ xbuzz.summary を1件として使う
          const stepperItems =
            workAiHistory.length > 0
              ? workAiHistory.map((c) => ({
                  body: c.body,
                  generatedAt: c.generatedAt,
                  title: c.title ?? undefined,
                }))
              : xbuzz?.summary
                ? [{ body: xbuzz.summary, generatedAt: "", title: undefined }]
                : [];

          if (stepperItems.length === 0) return null;

          return (
            <div className="card p-4 sm:p-5 border-l-4 border-l-accent">
              <div className="flex items-center gap-2 mb-1.5">
                <span className="text-[0.7rem] font-black text-accent">AIの所感</span>
                <span className="text-[0.66rem] text-muted">Grok・X</span>
              </div>
              {stepperItems.length >= 2 ? (
                <AiCommentStepper items={stepperItems} />
              ) : (
                <p className="text-[0.9rem] leading-[1.8] text-ink-soft whitespace-pre-wrap">
                  {stepperItems[0]?.body}
                </p>
              )}
            </div>
          );
        })()}
        {cohort && <CohortPositionPanel position={cohort} />}
        <WorkAnalysisSections analysis={analysis} cohortReaction={cohortReaction} />

        {/* 話数別 3面比較（実況×満足度×Xバズ）*/}
        {(() => {
          const tripleData = buildEpisodeTriple(analysis, xbuzz?.episodes ?? []);
          if (!tripleData) return null;
          return (
            <section className="card p-5 sm:p-6">
              <h2 className="section-title text-lg mb-1">話数別 3面比較（実況×満足度×Xバズ）</h2>
              <p className="text-xs text-muted mb-3">
                各話の3指標を重ねて相対比較します。
              </p>
              <p className="text-xs text-muted mb-4 leading-relaxed">
                各指標は0〜100に正規化した相対比較。実況=コメント数（系列内最大=100）、満足度=Annict良い率（%）、Xバズ=volume×20。
              </p>
              <EpisodeTripleChart data={tripleData} />
            </section>
          );
        })()}

        {/* Xの反応（X Premium・x_search）。X データが無ければ自動で非表示 */}
        <XBuzzSection buzz={xbuzz} posts={xposts} />

        <p className="text-xs text-muted leading-relaxed">
          ※ データソース: ニコニコ実況 過去ログAPI・Annict。各サービスの利用者を母数とした参考値です。
        </p>
      </div>
    </div>
  );
}
