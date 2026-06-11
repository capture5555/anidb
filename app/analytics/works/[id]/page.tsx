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
  // 3本の重い取得を並列化（互いに依存しない）。各々のフォールバックは従来どおり。
  const [analysis, cohort, cohortReaction, xbuzz, xposts] = await Promise.all([
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
  ]);
  if (!analysis) notFound();

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
      <header className="card mt-3 p-5 flex items-center gap-5">
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
          <h1 className="text-xl sm:text-2xl font-black leading-snug mt-1">{analysis.title}</h1>
          <Link
            href={`/works/${analysis.workId}`}
            className="inline-block mt-1.5 text-xs font-bold text-primary hover:underline underline-offset-2"
          >
            作品ページへ →
          </Link>
        </div>
      </header>

      <div className="space-y-5 py-5">
        {/* AIの所感（既存の Grok x_search 「作品の声」を短く再利用）。無ければ非表示。 */}
        {xbuzz?.summary && (
          <div className="card p-4 sm:p-5 border-l-4 border-l-accent">
            <div className="flex items-center gap-2 mb-1.5">
              <span className="text-[0.7rem] font-black text-accent">AIの所感</span>
              <span className="text-[0.66rem] text-muted">Grok・X</span>
            </div>
            <p className="text-[0.9rem] leading-[1.8] text-ink-soft whitespace-pre-wrap">
              {xbuzz.summary}
            </p>
          </div>
        )}
        {cohort && <CohortPositionPanel position={cohort} />}
        <WorkAnalysisSections analysis={analysis} cohortReaction={cohortReaction} />

        {/* Xの反応（X Premium・x_search）。X データが無ければ自動で非表示 */}
        <XBuzzSection buzz={xbuzz} posts={xposts} />

        <p className="text-xs text-muted leading-relaxed">
          ※ データソース: ニコニコ実況 過去ログAPI・Annict。各サービスの利用者を母数とした参考値です。
        </p>
      </div>
    </div>
  );
}
