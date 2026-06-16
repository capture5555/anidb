"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * 認知度（横）× 熱量（縦）の4象限散布図。
 * 各点は作品。50の基準線で4象限に分け、クリックで作品ページへ。
 */

export interface ScatterPoint {
  workId: string;
  title: string;
  x: number; // 認知度偏差
  y: number; // 熱量偏差
  overall: number;
}

const W = 720;
const H = 520;
const PAD = { top: 28, right: 24, bottom: 44, left: 48 };

const QUAD_BG = [
  { label: "ニッチ深掘り型", cx: 0.25, cy: 0.75, color: "#9b59b6" },
  { label: "初速一発型", cx: 0.75, cy: 0.75, color: "#f5a623" },
  { label: "口コミ型・ダークホース", cx: 0.25, cy: 0.25, color: "#2ebd85" },
  { label: "王道ヒット", cx: 0.75, cy: 0.25, color: "#e8482f" },
];

export function QuadrantScatter({ points }: { points: ScatterPoint[] }) {
  const router = useRouter();
  const [hover, setHover] = useState<{ x: number; y: number; p: ScatterPoint } | null>(null);

  if (points.length === 0) {
    return <p className="text-sm text-muted py-8 text-center">データ収集中です。</p>;
  }

  // 軸レンジ（30〜70を基本に、外れ値があれば広げる）
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const lo = Math.min(30, Math.floor(Math.min(...xs, ...ys) / 5) * 5);
  const hi = Math.max(70, Math.ceil(Math.max(...xs, ...ys) / 5) * 5);

  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;
  const sx = (v: number) => PAD.left + ((v - lo) / (hi - lo)) * innerW;
  const sy = (v: number) => PAD.top + (1 - (v - lo) / (hi - lo)) * innerH;

  return (
    <div className="relative">
      <div className="overflow-x-auto">
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full min-w-[560px]" role="img" aria-label="認知度×熱量の散布図">
          {/* 象限の背景ラベル */}
          {QUAD_BG.map((q) => (
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

          {/* 基準線（50） */}
          <line x1={sx(50)} x2={sx(50)} y1={PAD.top} y2={H - PAD.bottom} stroke="#9aa3b2" strokeDasharray="4 4" />
          <line x1={PAD.left} x2={W - PAD.right} y1={sy(50)} y2={sy(50)} stroke="#9aa3b2" strokeDasharray="4 4" />

          {/* 枠 */}
          <rect x={PAD.left} y={PAD.top} width={innerW} height={innerH} fill="none" stroke="#e8eaef" />

          {/* 軸ラベル */}
          <text x={W / 2} y={H - 10} textAnchor="middle" fontSize="11" fill="#8a909c">
            認知度（偏差値）→ 広く知られている
          </text>
          <text
            x={14}
            y={H / 2}
            textAnchor="middle"
            fontSize="11"
            fill="#8a909c"
            transform={`rotate(-90 14 ${H / 2})`}
          >
            熱量（偏差値）→ 濃く語られている
          </text>

          {/* 点 */}
          {points.map((p) => {
            const cx = sx(p.x);
            const cy = sy(p.y);
            const r = Math.max(4, Math.min(9, 3 + (p.overall - 45) / 4));
            return (
              <circle
                key={p.workId}
                cx={cx}
                cy={cy}
                r={r}
                fill="#2f6fdb"
                fillOpacity={0.55}
                stroke="#2f6fdb"
                strokeWidth={1}
                style={{ cursor: "pointer" }}
                onMouseEnter={(e) => {
                  const rect = (e.target as SVGElement).closest("svg")!.getBoundingClientRect();
                  setHover({ x: (cx / W) * rect.width, y: (cy / H) * rect.height, p });
                }}
                onMouseLeave={() => setHover(null)}
                onClick={() => router.push(`/works/${p.workId}`)}
              />
            );
          })}
        </svg>
      </div>

      {hover && (
        <div
          className="pointer-events-none absolute z-10 rounded-md bg-[#1b1f27] text-white text-xs px-3 py-2 shadow-lg max-w-[220px]"
          style={{ left: hover.x + 10, top: hover.y - 10 }}
        >
          <p className="font-bold truncate">{hover.p.title}</p>
          <p className="tabular-nums">認知 {hover.p.x} ／ 熱量 {hover.p.y}</p>
          <p className="tabular-nums">総合偏差値 {hover.p.overall}</p>
        </div>
      )}
    </div>
  );
}
