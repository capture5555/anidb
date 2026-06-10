"use client";

import { useMemo, useState } from "react";
import Link from "next/link";

/**
 * 話数別残留率の折れ線グラフ（1話=100%基準、複数作品比較）。
 * REGZA(TimeOn)の分析コラム風: 100%の基準線を強調し、100%超の右肩上がりも表現する。
 */

export interface RetentionPointInput {
  episodeNumber: number;
  numberText: string | null;
  records: number;
  pct: number;
}
export interface RetentionSeriesInput {
  workId: string;
  title: string;
  posterUrl: string | null;
  popularity: number;
  points: RetentionPointInput[];
  /** percent: 生の%値（満足度など）。ツールチップの件数表示と破線スタイルが変わる */
  kind?: "count" | "percent";
}

const COLORS = [
  "#e8482f", // 朱
  "#2f6fdb", // 青
  "#2ebd85", // 緑
  "#f5a623", // 橙
  "#9b59b6", // 紫
  "#17a2b8", // 青緑
  "#e84393", // ピンク
  "#6c5ce7", // 藍紫
  "#a0822d", // 金茶
  "#576574", // 鈍色
];

const W = 760;
const H = 380;
const PAD = { top: 18, right: 24, bottom: 34, left: 46 };

export function RetentionChart({
  series,
  linkLegend = true,
}: {
  series: RetentionSeriesInput[];
  linkLegend?: boolean;
}) {
  const [active, setActive] = useState<string | null>(null);
  const [tip, setTip] = useState<{ x: number; y: number; lines: string[] } | null>(null);

  const { maxEp, minPct, maxPct } = useMemo(() => {
    let maxEp = 2;
    let minPct = 100;
    let maxPct = 100;
    for (const s of series) {
      for (const p of s.points) {
        maxEp = Math.max(maxEp, p.episodeNumber);
        minPct = Math.min(minPct, p.pct);
        maxPct = Math.max(maxPct, p.pct);
      }
    }
    minPct = Math.floor((minPct - 6) / 10) * 10;
    maxPct = Math.ceil((maxPct + 6) / 10) * 10;
    return { maxEp, minPct: Math.max(0, minPct), maxPct };
  }, [series]);

  if (series.length === 0) {
    return (
      <p className="text-sm text-muted py-8 text-center">
        データ収集中です。日次スナップショットが貯まると表示されます。
      </p>
    );
  }

  const x = (ep: number) => PAD.left + ((ep - 1) / Math.max(1, maxEp - 1)) * (W - PAD.left - PAD.right);
  const y = (pct: number) =>
    PAD.top + (1 - (pct - minPct) / Math.max(1, maxPct - minPct)) * (H - PAD.top - PAD.bottom);

  // Yグリッド（10%刻み、ラベルは20%刻み）
  const gridLines: number[] = [];
  for (let v = minPct; v <= maxPct; v += 10) gridLines.push(v);

  return (
    <div className="relative">
      <div className="overflow-x-auto">
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full min-w-[560px]" role="img" aria-label="話数別残留率グラフ">
          {/* グリッド */}
          {gridLines.map((v) => (
            <g key={v}>
              <line
                x1={PAD.left}
                x2={W - PAD.right}
                y1={y(v)}
                y2={y(v)}
                stroke={v === 100 ? "#9aa3b2" : "#e8eaef"}
                strokeWidth={v === 100 ? 1.5 : 1}
                strokeDasharray={v === 100 ? "" : ""}
              />
              {v % 20 === 0 && (
                <text x={PAD.left - 8} y={y(v) + 4} textAnchor="end" fontSize="11" fill="#8a909c">
                  {v}%
                </text>
              )}
            </g>
          ))}
          {/* X軸ラベル（話数） */}
          {Array.from({ length: maxEp }, (_, i) => i + 1).map((ep) => (
            <text key={ep} x={x(ep)} y={H - PAD.bottom + 18} textAnchor="middle" fontSize="11" fill="#8a909c">
              {ep}話目
            </text>
          ))}

          {/* 折れ線 */}
          {series.map((s, si) => {
            const color = COLORS[si % COLORS.length];
            const dim = active != null && active !== s.workId;
            const d = s.points
              .map((p, i) => `${i === 0 ? "M" : "L"}${x(p.episodeNumber)},${y(p.pct)}`)
              .join(" ");
            return (
              <g
                key={s.workId}
                opacity={dim ? 0.14 : 1}
                onMouseEnter={() => setActive(s.workId)}
                onMouseLeave={() => {
                  setActive(null);
                  setTip(null);
                }}
                style={{ cursor: "pointer", transition: "opacity .15s" }}
              >
                <path
                  d={d}
                  fill="none"
                  stroke={color}
                  strokeWidth={active === s.workId ? 3 : 2}
                  strokeDasharray={s.kind === "percent" ? "6 4" : undefined}
                />
                {s.points.map((p) => (
                  <circle
                    key={p.episodeNumber}
                    cx={x(p.episodeNumber)}
                    cy={y(p.pct)}
                    r={active === s.workId ? 4.5 : 3}
                    fill="#fff"
                    stroke={color}
                    strokeWidth={2}
                    onMouseEnter={(e) => {
                      const rect = (e.target as SVGElement).closest("svg")!.getBoundingClientRect();
                      setTip({
                        x: ((x(p.episodeNumber) / W) * rect.width),
                        y: ((y(p.pct) / H) * rect.height),
                        lines:
                          s.kind === "percent"
                            ? [s.title, `${p.numberText ?? `${p.episodeNumber}話`}: ${p.pct}%`]
                            : [
                                s.title,
                                `${p.numberText ?? `${p.episodeNumber}話`}: ${p.pct}%`,
                                `${p.records.toLocaleString()}件`,
                              ],
                      });
                    }}
                  />
                ))}
              </g>
            );
          })}
        </svg>
      </div>

      {/* ツールチップ */}
      {tip && (
        <div
          className="pointer-events-none absolute z-10 rounded-md bg-[#1b1f27] text-white text-xs px-3 py-2 shadow-lg max-w-[240px]"
          style={{ left: tip.x + 10, top: tip.y - 10 }}
        >
          {tip.lines.map((l, i) => (
            <p key={i} className={i === 0 ? "font-bold truncate" : "tabular-nums"}>
              {l}
            </p>
          ))}
        </div>
      )}

      {/* 凡例 */}
      <ul className="flex flex-wrap gap-x-4 gap-y-1.5 mt-4">
        {series.map((s, si) => {
          const color = COLORS[si % COLORS.length];
          const dim = active != null && active !== s.workId;
          const inner = (
            <>
              <span className="inline-block w-3.5 h-[3px] rounded-full" style={{ backgroundColor: color }} />
              <span className="max-w-[180px] truncate">{s.title}</span>
            </>
          );
          return (
            <li key={s.workId} style={{ opacity: dim ? 0.35 : 1 }}>
              {linkLegend ? (
                <Link
                  href={`/analytics/works/${s.workId}`}
                  className="inline-flex items-center gap-1.5 text-xs text-ink-soft hover:text-ink"
                  onMouseEnter={() => setActive(s.workId)}
                  onMouseLeave={() => setActive(null)}
                >
                  {inner}
                </Link>
              ) : (
                <span
                  className="inline-flex items-center gap-1.5 text-xs text-ink-soft"
                  onMouseEnter={() => setActive(s.workId)}
                  onMouseLeave={() => setActive(null)}
                >
                  {inner}
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
