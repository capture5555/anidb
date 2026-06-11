import Link from "next/link";
import type { Metadata } from "next";
import { getStudioDetail, type YearAvgScore } from "@/lib/analytics/studios";
import { WorkCover } from "@/components/WorkCover";
import { SEASON_LABELS, formatSeason } from "@/lib/season";
import { formatPopularity } from "@/lib/format";
import type { Season } from "@/lib/types";

export const revalidate = 1800;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ name: string }>;
}): Promise<Metadata> {
  const { name } = await params;
  const decoded = decodeURIComponent(name);
  const detail = await getStudioDetail(decoded).catch(() => null);
  const studio = detail?.studio ?? decoded;
  return { title: `${studio}の制作分析` };
}

/** 打率の小数表記 .XXX */
function formatBa(ba: number): string {
  return `.${String(Math.round(ba * 1000)).padStart(3, "0")}`;
}

function seasonLabel(year: number | null, name: string | null): string {
  return formatSeason(year, (name as Season | null) ?? null);
}

export default async function StudioDetailPage({
  params,
}: {
  params: Promise<{ name: string }>;
}) {
  const { name } = await params;
  const decoded = decodeURIComponent(name);
  const detail = await getStudioDetail(decoded).catch(() => null);

  if (!detail) {
    return (
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <Breadcrumb name={decoded} />
        <div className="card mt-3 p-8 text-center text-sm text-muted">
          「{decoded}」に一致する制作会社のデータが見つかりませんでした。
          <br />
          表記ゆれ（英字／カナ）や、まだスコアの付いた作品が無い可能性があります。
          <div className="mt-4">
            <Link href="/analytics?view=industry" className="text-primary font-bold hover:underline underline-offset-2">
              業界データへ戻る →
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl px-4 sm:px-6">
      <Breadcrumb name={detail.studio} />

      {/* ヘッダーカード */}
      <header className="card mt-3 p-5 sm:p-6">
        <p className="text-xs font-bold text-accent">スタジオ別 制作分析</p>
        <h1 className="text-xl sm:text-2xl font-black leading-snug mt-1">{detail.studio}</h1>

        <div className="mt-4 grid grid-cols-2 sm:grid-cols-5 gap-3">
          <Stat label="制作本数" value={`${detail.worksCount}`} />
          <Stat label="平均スコア" value={detail.scoredWorks > 0 ? `${Math.round(detail.avgScore)}` : "—"} />
          <Stat label="打率" value={formatBa(detail.battingAverage)} />
          <Stat label="一貫性" value={detail.consistency != null ? `${detail.consistency}` : "—"} />
          <Stat label="平均人気度" value={formatPopularity(detail.avgPopularity)} />
        </div>

        <p className="text-[0.68rem] text-muted mt-4 leading-relaxed">
          平均スコアはスコア付き作品（{detail.scoredWorks}本）が対象。打率＝各作品が「同クールのスコア中央値」以上だった割合。
          一貫性＝スコアのばらつきの小ささ（0-100）。スコアはAniList優先、なければMAL換算。
          ※ 各サービス利用者を母数とした参考値であり、テレビ視聴率ではありません。
        </p>
      </header>

      <div className="space-y-5 py-5">
        {/* 年別トレンド */}
        {detail.yearTrend.length > 0 && (
          <section className="card p-5 sm:p-6">
            <h2 className="section-title text-lg mb-1">年別トレンド（平均スコア）</h2>
            <p className="text-xs text-muted mb-4">
              スコア付き作品の年別平均スコア（直近{detail.yearTrend.length}年）。スコアはAniList優先、なければMAL換算。
            </p>
            <YearTrendChart data={detail.yearTrend} />
          </section>
        )}

        {/* 作品一覧 */}
        <section className="card p-5 sm:p-6">
          <h2 className="section-title text-lg mb-1">作品一覧</h2>
          <p className="text-xs text-muted mb-4">
            「アニメーション制作」としてクレジットされた作品（新しいクール順）。
          </p>
          {detail.works.length === 0 ? (
            <p className="text-sm text-muted">作品がありません。</p>
          ) : (
            <ul className="divide-y divide-line">
              {detail.works.map((w) => (
                <li key={w.workId} className="flex items-center gap-3 py-2.5">
                  <Link href={`/works/${w.workId}`} className="shrink-0">
                    <WorkCover id={w.workId} title={w.title} url={w.posterUrl} className="w-10 h-14 rounded-md" />
                  </Link>
                  <div className="min-w-0 flex-1">
                    <Link
                      href={`/works/${w.workId}`}
                      className="block text-sm font-bold text-ink hover:text-primary transition truncate"
                    >
                      {w.title}
                    </Link>
                    <p className="text-xs text-muted tabular-nums">
                      {seasonLabel(w.seasonYear, w.seasonName)}
                    </p>
                  </div>
                  <span className="shrink-0 text-right w-16">
                    <span className="block font-black text-accent tabular-nums">
                      {w.score != null ? Math.round(w.score) : "—"}
                    </span>
                    <span className="block text-[0.6rem] text-muted">スコア</span>
                  </span>
                  <span className="shrink-0 text-right w-20">
                    <span className="block text-xs font-bold text-ink-soft tabular-nums">
                      {w.popularity != null ? formatPopularity(w.popularity) : "—"}
                    </span>
                    <span className="block text-[0.6rem] text-muted">人気度</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <p className="text-xs text-muted leading-relaxed">
          ※ スタジオの同定は「アニメーション制作」クレジットのテキストに基づく近似であり、表記ゆれ等で精度に限界があります。
          スコアはAniList/MAL由来・各サービス利用者を母数とした参考値です。
        </p>
      </div>
    </div>
  );
}

function Breadcrumb({ name }: { name: string }) {
  return (
    <div className="pt-4 text-xs text-muted">
      <Link href="/analytics" className="hover:text-primary">
        アニメ分析
      </Link>
      <span className="mx-1.5">›</span>
      <Link href="/analytics?view=industry" className="hover:text-primary">
        スタジオ
      </Link>
      <span className="mx-1.5">›</span>
      <span className="text-ink-soft">{name}</span>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="border border-line rounded-lg p-3 bg-paper">
      <p className="text-[0.62rem] text-muted">{label}</p>
      <p className="text-lg font-black text-ink tabular-nums leading-tight mt-0.5">{value}</p>
    </div>
  );
}

/** 年別トレンドの折れ線（ScoreSparkline をやや大きくしたインラインSVG）。 */
function YearTrendChart({ data }: { data: YearAvgScore[] }) {
  if (data.length < 2) {
    return (
      <p className="text-sm text-muted tabular-nums">
        {data.length === 1 ? `${data[0].year}年: ${data[0].avgScore.toFixed(1)}` : "データ不足"}
      </p>
    );
  }
  const W = 480;
  const H = 120;
  const PAD_X = 28;
  const PAD_Y = 18;
  const scores = data.map((d) => d.avgScore);
  const minS = Math.min(...scores);
  const maxS = Math.max(...scores);
  const range = maxS - minS || 1;
  const px = (i: number) => PAD_X + (i / (data.length - 1)) * (W - PAD_X * 2);
  const py = (s: number) => PAD_Y + (1 - (s - minS) / range) * (H - PAD_Y * 2);
  const points = data.map((d, i) => `${px(i).toFixed(1)},${py(d.avgScore).toFixed(1)}`).join(" ");

  return (
    <svg
      width="100%"
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label="年別平均スコアの推移"
      className="overflow-visible max-w-xl"
    >
      <polyline
        points={points}
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
        strokeLinecap="round"
        className="text-accent"
      />
      {data.map((d, i) => (
        <g key={d.year}>
          <circle cx={px(i)} cy={py(d.avgScore)} r="3" className="fill-current text-accent" />
          <text
            x={px(i)}
            y={py(d.avgScore) - 8}
            textAnchor="middle"
            className="fill-current text-ink-soft"
            fontSize="11"
            fontWeight="700"
          >
            {d.avgScore.toFixed(1)}
          </text>
          <text
            x={px(i)}
            y={H - 2}
            textAnchor="middle"
            className="fill-current text-muted"
            fontSize="10"
          >
            {d.year}
          </text>
        </g>
      ))}
    </svg>
  );
}
