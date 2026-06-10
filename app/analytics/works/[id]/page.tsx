export const dynamic = "force-dynamic";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getWorkAnalysis } from "@/lib/analytics/viewing";
import { RetentionChart } from "@/components/charts/RetentionChart";
import { EpisodeTrendChart, EpisodeHeatSelector } from "@/components/charts/WorkAnalysisPanel";
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
  const analysis = await getWorkAnalysis(id).catch(() => null);
  if (!analysis) notFound();

  // 残留率の比較シリーズ（実況コメント / Annict記録）
  const retentionSeries = [];
  if (analysis.episodes.length >= 2) {
    const base = analysis.episodes[0].totalComments;
    if (base > 0) {
      retentionSeries.push({
        workId: "jikkyo",
        title: "実況コメント数（ニコニコ実況）",
        posterUrl: null,
        popularity: 0,
        points: analysis.episodes.map((e, i) => ({
          episodeNumber: i + 1,
          numberText: e.episodeLabel,
          records: e.totalComments,
          pct: Math.round((e.totalComments / base) * 1000) / 10,
        })),
      });
    }
  }
  if (analysis.annictPoints.length >= 2) {
    retentionSeries.push({
      workId: "annict",
      title: "記録ユーザー数（Annict）",
      posterUrl: null,
      popularity: 0,
      points: analysis.annictPoints,
    });
  }
  if (analysis.satisfactionPoints.length >= 2) {
    retentionSeries.push({
      workId: "satisfaction",
      title: "満足度（Annict・実数%）",
      posterUrl: null,
      popularity: 0,
      kind: "percent" as const,
      points: analysis.satisfactionPoints.map((p) => ({
        episodeNumber: p.episodeNumber,
        numberText: p.numberText,
        records: 0,
        pct: p.rate,
      })),
    });
  }

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
        {/* 話数別コメント数 */}
        {analysis.episodes.length > 0 && (
          <section className="card p-5 sm:p-6">
            <h2 className="section-title text-lg mb-1">話数別の実況コメント数</h2>
            <p className="text-xs text-muted mb-4">
              各話の放送時に投稿されたニコニコ実況のコメント総数（複数チャンネル放送の場合は最多のチャンネル）。
            </p>
            <EpisodeTrendChart episodes={analysis.episodes} />
          </section>
        )}

        {/* 残留率 */}
        {retentionSeries.length > 0 && (
          <section className="card p-5 sm:p-6">
            <h2 className="section-title text-lg mb-1">視聴継続率と満足度</h2>
            <p className="text-xs text-muted mb-4">
              実線＝初回放送を100%としたときの推移（実況コメント数／Annict記録数）。
              破線＝各話の満足度（Annictユーザーの「良い」評価率の実数%）。
              「人は減ったが残った人の満足度は高い」といったパターンが見えます（テレビ視聴率ではありません）。
            </p>
            <RetentionChart series={retentionSeries} linkLegend={false} />
          </section>
        )}

        {/* 全話の盛り上がり */}
        {analysis.episodes.length > 0 && (
          <section className="card p-5 sm:p-6">
            <h2 className="section-title text-lg mb-1">放送回ごとの盛り上がり</h2>
            <p className="text-xs text-muted mb-4">
              話数を選ぶと、その回の分単位コメント数とリアクション内訳が見られます。▲はピーク。
            </p>
            <EpisodeHeatSelector episodes={analysis.episodes} />
          </section>
        )}

        <p className="text-xs text-muted leading-relaxed">
          ※ データソース: ニコニコ実況 過去ログAPI・Annict。各サービスの利用者を母数とした参考値です。
        </p>
      </div>
    </div>
  );
}
