/**
 * 今期サマリーレポートページ。
 * 業界実務者が共有・印刷できるよう1ページに今期の要点を集約する。
 * print: break-inside-avoid で各ブロックが途中で切れないよう配慮。
 */
import Link from "next/link";
import { seasonOf, formatSeason } from "@/lib/season";
import { getSeasonComment } from "@/lib/analytics/seasonComment";
import { getOverallRanking, type OverallRankingRow } from "@/lib/analytics/overallRanking";
import { getRisers, type RiserRow } from "@/lib/analytics/risers";
import { getEpisodeBuzzLeaders, type EpisodeBuzzLeader } from "@/lib/analytics/xbuzz";
import { getLatestDailyNews, type DailyNews } from "@/lib/analytics/news";

export const revalidate = 1800;

export const metadata = { title: "今期サマリーレポート | アニメ分析" };

/* ---------------------------------------------------------------- ユーティリティ */

/** ISO 文字列を JST の「YYYY年M月D日 HH:mm」に変換する。 */
function toJstLabel(iso: string): string {
  try {
    const d = new Date(iso);
    const jst = new Date(d.getTime() + 9 * 60 * 60 * 1000);
    const y = jst.getUTCFullYear();
    const mo = jst.getUTCMonth() + 1;
    const day = jst.getUTCDate();
    const h = String(jst.getUTCHours()).padStart(2, "0");
    const min = String(jst.getUTCMinutes()).padStart(2, "0");
    return `${y}年${mo}月${day}日 ${h}:${min} JST`;
  } catch {
    return "";
  }
}

/** 今の日時を JST の「YYYY年M月D日 HH:mm」で返す。 */
function nowJstLabel(): string {
  return toJstLabel(new Date().toISOString());
}

/* ================================================================ メインページ */

export default async function ReportPage() {
  const { year, season } = seasonOf(new Date());
  const seasonLabel = formatSeason(year, season);

  // 各データを並列取得。失敗時は防御的フォールバック。
  const [seasonComment, overallRanking, risers, episodeBuzzLeaders, dailyNews] = await Promise.all([
    getSeasonComment().catch(() => null),
    getOverallRanking().catch((): OverallRankingRow[] => []),
    getRisers(5).catch((): RiserRow[] => []),
    getEpisodeBuzzLeaders(8).catch((): EpisodeBuzzLeader[] => []),
    getLatestDailyNews().catch((): DailyNews | null => null),
  ]);

  const top10 = overallRanking.slice(0, 10);

  return (
    <div className="mx-auto max-w-3xl px-4 sm:px-6 py-6 print:px-0 print:py-0 print:max-w-none">
      {/* パンくず（印刷時非表示） */}
      <nav className="text-xs text-muted mb-4 print:hidden">
        <Link href="/analytics" className="hover:text-primary transition">
          アニメ分析
        </Link>
        <span className="mx-1.5">›</span>
        <span className="text-ink-soft">今期サマリー</span>
      </nav>

      {/* ヘッダー */}
      <div className="break-inside-avoid mb-6 pb-4 border-b-2 border-line print:mb-4">
        <h1 className="text-2xl font-black text-ink leading-tight">
          {seasonLabel}クール 今期サマリー
        </h1>
        <p className="text-xs text-muted mt-1">生成日時: {nowJstLabel()}</p>
      </div>

      {/* 今期の所感 */}
      {seasonComment && (
        <section className="card p-4 sm:p-5 mb-5 border-l-4 border-l-accent break-inside-avoid print:shadow-none print:border print:rounded-none">
          <h2 className="section-title text-base mb-2">今期の所感</h2>
          {seasonComment.label && (
            <p className="text-[0.68rem] text-muted mb-2">
              {seasonComment.label}
              {seasonComment.generatedAt
                ? ` ・ ${toJstLabel(seasonComment.generatedAt)} 生成`
                : ""}
            </p>
          )}
          <p className="text-sm leading-relaxed text-ink-soft whitespace-pre-wrap">
            {seasonComment.text}
          </p>
        </section>
      )}

      {/* 総合ランキング 上位10 */}
      {top10.length > 0 && (
        <section className="card p-4 sm:p-5 mb-5 break-inside-avoid print:shadow-none print:border print:rounded-none">
          <h2 className="section-title text-base mb-1">総合ランキング 上位10</h2>
          <p className="text-[0.68rem] text-muted mb-3">
            認知・批評・実況・Xバズ・継続の5シグナルを加重平均したスコア(0〜100)
          </p>
          <ol className="divide-y divide-line">
            {top10.map((row, i) => (
              <li key={row.workId} className="flex items-center gap-3 py-2">
                <span
                  className={`w-6 text-center font-black tabular-nums shrink-0 ${
                    i < 3 ? "text-accent" : "text-muted"
                  }`}
                >
                  {i + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <Link
                    href={`/analytics/works/${row.workId}`}
                    className="block text-sm font-bold text-ink hover:text-primary transition truncate print:no-underline"
                  >
                    {row.title}
                  </Link>
                </div>
                <span className="shrink-0 font-black text-accent tabular-nums text-base">
                  {row.score.toFixed(0)}
                  <span className="text-[0.62rem] font-normal text-muted ml-0.5">pts</span>
                </span>
              </li>
            ))}
          </ol>
        </section>
      )}

      {/* 急上昇 */}
      {risers.length > 0 && (
        <section className="card p-4 sm:p-5 mb-5 break-inside-avoid print:shadow-none print:border print:rounded-none">
          <h2 className="section-title text-base mb-1">急上昇</h2>
          <p className="text-[0.68rem] text-muted mb-3">
            直近話の実況コメント数が前話平均を大きく上回った作品
          </p>
          <ol className="divide-y divide-line">
            {risers.map((row, i) => (
              <li key={row.workId} className="flex items-center gap-3 py-2">
                <span
                  className={`w-6 text-center font-black tabular-nums shrink-0 ${
                    i < 3 ? "text-accent" : "text-muted"
                  }`}
                >
                  {i + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <Link
                    href={`/analytics/works/${row.workId}`}
                    className="block text-sm font-bold text-ink hover:text-primary transition truncate print:no-underline"
                  >
                    {row.title}
                    {row.latestLabel && (
                      <span className="font-normal text-ink-soft ml-1.5 text-xs">
                        {row.latestLabel}
                      </span>
                    )}
                  </Link>
                </div>
                <span className="shrink-0 text-sm font-black text-rose-600 tabular-nums whitespace-nowrap">
                  +{Math.round(row.deltaPct)}%
                </span>
              </li>
            ))}
          </ol>
        </section>
      )}

      {/* 注目の話数 */}
      {episodeBuzzLeaders.length > 0 && (
        <section className="card p-4 sm:p-5 mb-5 break-inside-avoid print:shadow-none print:border print:rounded-none">
          <h2 className="section-title text-base mb-1">注目の話数</h2>
          <p className="text-[0.68rem] text-muted mb-3">
            X バズ量が多い話数（クール横断）
          </p>
          <ol className="divide-y divide-line">
            {episodeBuzzLeaders.map((row, i) => (
              <li key={`${row.workId}-${row.episodeId ?? i}`} className="flex items-center gap-3 py-2">
                <span
                  className={`w-6 text-center font-black tabular-nums shrink-0 ${
                    i < 3 ? "text-accent" : "text-muted"
                  }`}
                >
                  {i + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <Link
                    href={`/analytics/works/${row.workId}`}
                    className="block text-sm font-bold text-ink hover:text-primary transition truncate print:no-underline"
                  >
                    {row.title}
                    <span className="font-normal text-ink-soft ml-1.5 text-xs">
                      {row.episodeLabel}
                    </span>
                  </Link>
                  {row.topics.length > 0 && (
                    <p className="text-[0.65rem] text-muted truncate mt-0.5">
                      {row.topics.slice(0, 5).join(" · ")}
                    </p>
                  )}
                </div>
                <span className="shrink-0 font-black text-accent tabular-nums text-sm">
                  {row.volume.toLocaleString()}
                  <span className="text-[0.62rem] font-normal text-muted ml-0.5">vol</span>
                </span>
              </li>
            ))}
          </ol>
        </section>
      )}

      {/* 今日のニュース */}
      {dailyNews && dailyNews.items.length > 0 && (
        <section className="card p-4 sm:p-5 mb-5 break-inside-avoid print:shadow-none print:border print:rounded-none">
          <h2 className="section-title text-base mb-1">今日のニュース</h2>
          <p className="text-[0.68rem] text-muted mb-3">
            {dailyNews.date}
            {dailyNews.generatedAt
              ? ` ・ ${toJstLabel(dailyNews.generatedAt)} 生成`
              : ""}
          </p>
          {dailyNews.body && (
            <p className="text-sm leading-relaxed text-ink-soft mb-3 whitespace-pre-wrap">
              {dailyNews.body}
            </p>
          )}
          <ul className="divide-y divide-line">
            {dailyNews.items.slice(0, 6).map((item, i) => (
              <li key={i} className="py-2">
                <p className="text-sm font-bold text-ink leading-snug">
                  {item.url ? (
                    <a
                      href={item.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="hover:text-primary transition print:no-underline"
                    >
                      {item.title}
                    </a>
                  ) : (
                    item.title
                  )}
                </p>
                {item.summary !== item.title && (
                  <p className="text-[0.72rem] text-muted mt-0.5 leading-relaxed">
                    {item.summary}
                  </p>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* フッター注釈（印刷時も表示） */}
      <footer className="mt-6 pt-4 border-t border-line">
        <p className="text-[0.68rem] text-muted leading-relaxed">
          データソース: Annict（記録数）・ニコニコ実況過去ログAPI（コメント）・X/Grok（バズ・所感）。
          各値はサービス利用者を母数とした参考値です。テレビ視聴率ではありません。
        </p>
        <Link
          href="/analytics"
          className="inline-block mt-2 text-xs font-bold text-primary hover:underline underline-offset-2 print:hidden"
        >
          ← アニメ分析トップへ
        </Link>
      </footer>
    </div>
  );
}
