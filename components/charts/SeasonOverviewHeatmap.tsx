/**
 * シーズン俯瞰ヒートマップ（サーバーコンポーネント）。
 * 行 = 作品（人気順上位30件）、列 = 話数(1..最大話数)。
 * セル色 = 実況コメント数を log スケールで全体最大を基準に正規化した強度。
 * 0/欠測は薄いグレー。hover title に作品名・話数・コメント数を表示。
 */
import Link from "next/link";
import type { RetentionSeries } from "@/lib/analytics/viewing";

const MAX_ROWS = 30;
/** log スケール正規化: log(1 + v) / log(1 + globalMax) → [0, 1] */
function logIntensity(value: number, globalMax: number): number {
  if (globalMax <= 0 || value <= 0) return 0;
  return Math.log1p(value) / Math.log1p(globalMax);
}

/** 強度(0..1) を orange→red 方向の色に変換（低強度はグレー）。 */
function intensityColor(intensity: number): string {
  if (intensity <= 0) return "rgba(200,204,214,0.25)"; // 欠測・0: 薄いグレー
  // 0.05..1 → accent orange (e8482f) 系: opacity 0.10 + 0.90 * intensity
  const opacity = 0.10 + 0.90 * intensity;
  // interpolate: 薄→rgb(232,72,47)
  return `rgba(232,72,47,${opacity.toFixed(2)})`;
}

export function SeasonOverviewHeatmap({ rows }: { rows: RetentionSeries[] }) {
  // 人気順（すでにソート済みのはずだが念のため）上位30に絞る
  const limited = [...rows].sort((a, b) => b.popularity - a.popularity).slice(0, MAX_ROWS);
  if (limited.length < 2) return null;

  // 全セルのコメント数の最大値（log スケールの基準）
  let globalMax = 0;
  for (const s of limited) {
    for (const p of s.points) {
      if (p.records > globalMax) globalMax = p.records;
    }
  }
  if (globalMax <= 0) return null;

  // 最大話数（全作品横断）
  const maxEp = Math.max(...limited.map((s) => s.points.length));
  const epNums = Array.from({ length: maxEp }, (_, i) => i + 1);

  return (
    <div className="overflow-x-auto">
      <table
        className="border-collapse"
        style={{ minWidth: Math.max(500, 180 + maxEp * 22) }}
        aria-label="シーズン俯瞰ヒートマップ（作品×話数）"
      >
        {/* 列ヘッダ（話数） */}
        <thead>
          <tr>
            {/* 作品名列のヘッダ（空） */}
            <th className="w-44 sm:w-52" />
            {epNums.map((ep) => (
              <th
                key={ep}
                className="text-[0.6rem] font-bold text-muted px-0 pb-1 text-center tabular-nums"
                style={{ minWidth: 20, width: 22 }}
              >
                {ep}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {limited.map((series) => {
            // 話数→ポイントのマップ（episodeNumber は 1-origin の連番）
            const pointByEp = new Map(series.points.map((p) => [p.episodeNumber, p]));
            return (
              <tr key={series.workId}>
                {/* 作品名セル */}
                <td className="pr-2 py-0.5">
                  <Link
                    href={`/analytics/works/${series.workId}`}
                    className="flex items-center gap-1.5 group max-w-[10rem] sm:max-w-[12rem]"
                    title={series.title}
                  >
                    {/* ポスター小 */}
                    {series.posterUrl ? (
                      /* eslint-disable-next-line @next/next/no-img-element */
                      <img
                        src={series.posterUrl}
                        alt=""
                        className="w-5 h-7 object-cover rounded-[2px] shrink-0"
                        loading="lazy"
                      />
                    ) : (
                      <div className="w-5 h-7 rounded-[2px] bg-paper shrink-0" />
                    )}
                    <span className="text-[0.68rem] font-medium text-ink-soft group-hover:text-primary transition truncate block">
                      {series.title}
                    </span>
                  </Link>
                </td>
                {/* 話数セル */}
                {epNums.map((ep) => {
                  const point = pointByEp.get(ep);
                  const records = point?.records ?? 0;
                  const intensity = logIntensity(records, globalMax);
                  const bg = intensityColor(intensity);
                  const label = point?.numberText ?? `第${ep}話`;
                  const tooltipText =
                    records > 0
                      ? `${series.title} ${label}：${records.toLocaleString()}コメント`
                      : `${series.title} ${label}：データなし`;
                  return (
                    <td key={ep} className="p-[1px]">
                      <div
                        className="rounded-[2px]"
                        style={{ width: 20, height: 22, backgroundColor: bg }}
                        title={tooltipText}
                        aria-label={tooltipText}
                      />
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>

      {/* 凡例 */}
      <div className="flex items-center gap-2 mt-3 text-[0.68rem] text-muted">
        <span>薄い=静か</span>
        <div className="flex">
          {[0.10, 0.30, 0.50, 0.72, 1.0].map((v) => (
            <div
              key={v}
              className="w-5 h-3 first:rounded-l-[2px] last:rounded-r-[2px]"
              style={{ backgroundColor: `rgba(232,72,47,${(0.10 + 0.90 * v).toFixed(2)})` }}
            />
          ))}
        </div>
        <span>濃い=盛り上がる（log スケール）</span>
      </div>

      {limited.length === MAX_ROWS && rows.length > MAX_ROWS && (
        <p className="text-[0.65rem] text-muted mt-1.5">
          ※ 人気順上位{MAX_ROWS}作品を表示。全{rows.length}作品のうち{rows.length - MAX_ROWS}作品を省略。
        </p>
      )}
    </div>
  );
}
