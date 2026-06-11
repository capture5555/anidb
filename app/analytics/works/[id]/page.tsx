export const dynamic = "force-dynamic";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getWorkAnalysis } from "@/lib/analytics/viewing";
import { getCohortReactionAverage } from "@/lib/analytics/reactionFingerprint";
import { getWorkCohortPosition } from "@/lib/analytics/scorecard";
import { WorkAnalysisSections } from "@/components/charts/WorkAnalysisSections";
import { CohortPositionPanel } from "@/components/charts/CohortPositionPanel";
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
  const [analysis, cohort, cohortReaction] = await Promise.all([
    getWorkAnalysis(id).catch(() => null),
    getWorkCohortPosition(id).catch(() => null),
    // クール平均リアクション（レーダー比較用）。取得失敗時は undefined
    getCohortReactionAverage()
      .then((r) => r.shares)
      .catch(() => undefined),
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
        {cohort && <CohortPositionPanel position={cohort} />}
        <WorkAnalysisSections analysis={analysis} cohortReaction={cohortReaction} />

        <p className="text-xs text-muted leading-relaxed">
          ※ データソース: ニコニコ実況 過去ログAPI・Annict。各サービスの利用者を母数とした参考値です。
        </p>
      </div>
    </div>
  );
}
