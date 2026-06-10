import type { WorkAnalysis } from "@/lib/analytics/viewing";
import { buildEpisodeCommentary, type EpisodeNote } from "@/lib/analytics/episodeCommentary";
import { buildWorkReactions, buildWorkMoments } from "@/lib/analytics/workReactions";
import { RetentionChart, type RetentionSeriesInput } from "./RetentionChart";
import { EpisodeTrendChart, EpisodeHeatSelector } from "./WorkAnalysisPanel";
import {
  ReactionCompositionBar,
  EpisodeReactionTrend,
  WorkMomentsList,
} from "./WorkReactionCharts";

/**
 * 作品の視聴分析セクション（話数別コメント数・継続率＋満足度・全話の盛り上がり）。
 * 作品ページ(/works/[id])と作品別分析ページ(/analytics/works/[id])で共用する。
 */
export function WorkAnalysisSections({ analysis }: { analysis: WorkAnalysis }) {
  const retentionSeries = buildRetentionSeries(analysis);
  const commentary = buildEpisodeCommentary(analysis);
  const reactions = buildWorkReactions(analysis);
  const moments = buildWorkMoments(analysis, 5);

  return (
    <>
      {/* 話数別コメント数 */}
      {analysis.episodes.length > 0 && (
        <section className="card p-5 sm:p-6">
          <h2 className="section-title text-lg mb-1">話数別の実況コメント数</h2>
          <p className="text-xs text-muted mb-4">
            各話の放送時に投稿されたニコニコ実況のコメント総数（複数チャンネル放送の場合は最多のチャンネル）。
          </p>
          <EpisodeTrendChart episodes={analysis.episodes} />
          <CommentaryBlock summary={commentary.summary} notes={commentary.notes} />
        </section>
      )}

      {/* リアクションの傾向 */}
      {reactions && (
        <section className="card p-5 sm:p-6">
          <h2 className="section-title text-lg mb-1">リアクションの傾向</h2>
          <p className="text-xs text-muted mb-4">
            実況コメントの内容を分類し、この作品がどんな反応で盛り上がるかを構成比で示します。
          </p>
          <ReactionCompositionBar breakdown={reactions} />
          {reactions.perEpisode.length >= 2 && (
            <div className="mt-6 border-t border-line pt-4">
              <p className="text-xs font-bold text-ink-soft mb-3">話数ごとの内訳</p>
              <EpisodeReactionTrend perEpisode={reactions.perEpisode} />
            </div>
          )}
        </section>
      )}

      {/* 名場面（盛り上がった瞬間） */}
      {moments.length > 0 && (
        <section className="card p-5 sm:p-6">
          <h2 className="section-title text-lg mb-1">名場面（盛り上がった瞬間）</h2>
          <p className="text-xs text-muted mb-4">
            全話を通してコメントが集中した瞬間。1分間に流れたコメント数が多かった順に並べています。
          </p>
          <WorkMomentsList moments={moments} />
        </section>
      )}

      {/* 残留率＋満足度 */}
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
    </>
  );
}

/**
 * 話数別カーブの自動コメント（急落・急増の検出と原因の推定）。
 * 「収集ミスの疑い」と「実際の増減」を色分けして示す。
 */
function CommentaryBlock({ summary, notes }: { summary: string | null; notes: EpisodeNote[] }) {
  if (!summary && notes.length === 0) return null;

  return (
    <div className="mt-4 border-t border-line pt-4">
      <p className="text-xs font-bold text-ink-soft mb-2">自動分析コメント</p>
      {summary && <p className="text-xs text-muted leading-relaxed mb-2">{summary}</p>}
      <div className="space-y-2">
        {notes.map((n, i) => (
          <div
            key={i}
            className={`rounded-lg border-l-4 px-3 py-2 ${
              n.dataIssue
                ? "border-amber-400 bg-amber-50"
                : n.kind === "spike"
                  ? "border-emerald-400 bg-emerald-50"
                  : "border-line-strong bg-surface"
            }`}
          >
            <p className="text-xs font-bold text-ink-soft">
              {n.dataIssue && "⚠ "}
              {n.headline}
            </p>
            <p className="text-xs text-muted leading-relaxed mt-0.5">{n.detail}</p>
            {n.signals.length > 0 && (
              <ul className="mt-1.5 space-y-0.5">
                {n.signals.map((s, j) => (
                  <li key={j} className="text-[11px] text-muted leading-snug pl-3 -indent-3">
                    ・{s}
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

/** WorkAnalysis から残留率チャート用の系列（実況/Annict/満足度）を組み立てる */
export function buildRetentionSeries(analysis: WorkAnalysis): RetentionSeriesInput[] {
  const series: RetentionSeriesInput[] = [];

  if (analysis.episodes.length >= 2) {
    const base = analysis.episodes[0].totalComments;
    if (base > 0) {
      series.push({
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
    series.push({
      workId: "annict",
      title: "記録ユーザー数（Annict）",
      posterUrl: null,
      popularity: 0,
      points: analysis.annictPoints,
    });
  }
  if (analysis.satisfactionPoints.length >= 2) {
    series.push({
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

  return series;
}
