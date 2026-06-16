/**
 * 話数別 3面比較グラフ（サーバーコンポーネント・"use client" 不要・インライン SVG）。
 *
 * 3系列を 0〜100 に正規化して重ねた折れ線グラフ:
 *   - 実況コメント密度 (朱)
 *   - Annict満足度     (青)
 *   - Xバズ            (緑)
 *
 * 欠測（null）のポイントは折れ線を分断して描画する。
 * すべて静的 SVG のため "use client" は不要。
 */

import type { EpisodeTripleData, EpisodeTriplePoint } from "@/lib/analytics/episodeTriple";

/* ---------------------------------------------------------------- constants */

const W = 760;
const H = 320;
const PAD = { top: 16, right: 20, bottom: 34, left: 40 };

const SERIES = [
  {
    key: "commentNorm" as const,
    label: "実況コメント密度",
    color: "#e8482f",
    dashArray: undefined as string | undefined,
  },
  {
    key: "satisfactionNorm" as const,
    label: "Annict満足度",
    color: "#2f6fdb",
    dashArray: "6 3",
  },
  {
    key: "xbuzzNorm" as const,
    label: "Xバズ (volume×20)",
    color: "#2ebd85",
    dashArray: "3 4",
  },
] as const;

/* ---------------------------------------------------------------- helpers */

/** X 座標（話数インデックスから）。 */
function cx(ep: number, maxEp: number): number {
  return PAD.left + ((ep - 1) / Math.max(1, maxEp - 1)) * (W - PAD.left - PAD.right);
}

/** Y 座標（0〜100 のスケール）。 */
function cy(v: number): number {
  return PAD.top + (1 - v / 100) * (H - PAD.top - PAD.bottom);
}

/**
 * null を含む数値配列から SVG パス文字列を生成する。
 * null のポイントで折れ線を "リフト"（M で移動）して分断する。
 */
function makePath(
  points: EpisodeTriplePoint[],
  key: "commentNorm" | "satisfactionNorm" | "xbuzzNorm",
  maxEp: number,
): string {
  let d = "";
  let penDown = false;
  for (const p of points) {
    const v = p[key];
    if (v == null) {
      penDown = false;
      continue;
    }
    const px = cx(p.episodeIndex, maxEp);
    const py = cy(v);
    d += penDown ? ` L${px},${py}` : ` M${px},${py}`;
    penDown = true;
  }
  return d.trim();
}

/* ---------------------------------------------------------------- component */

export function EpisodeTripleChart({ data }: { data: EpisodeTripleData }) {
  const { points } = data;
  if (points.length === 0) return null;

  const maxEp = points[points.length - 1].episodeIndex;

  // 表示する系列だけに絞る
  const activeSeries = SERIES.filter((s) => {
    if (s.key === "commentNorm") return data.hasComment;
    if (s.key === "satisfactionNorm") return data.hasSatisfaction;
    if (s.key === "xbuzzNorm") return data.hasXBuzz;
    return false;
  });

  // Y グリッド (0/20/40/60/80/100)
  const gridValues = [0, 20, 40, 60, 80, 100];

  return (
    <div>
      {/* 凡例 */}
      <ul className="flex flex-wrap gap-x-4 gap-y-1 mb-3">
        {activeSeries.map((s) => (
          <li key={s.key} className="flex items-center gap-1.5 text-xs text-ink-soft">
            <svg
              width="28"
              height="12"
              viewBox="0 0 28 12"
              aria-hidden="true"
              className="shrink-0"
            >
              <line
                x1="2"
                y1="6"
                x2="26"
                y2="6"
                stroke={s.color}
                strokeWidth="2"
                strokeDasharray={s.dashArray}
              />
              <circle cx="14" cy="6" r="3" fill="#fff" stroke={s.color} strokeWidth="2" />
            </svg>
            <span>{s.label}</span>
          </li>
        ))}
      </ul>

      {/* SVG グラフ */}
      <div className="overflow-x-auto">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="w-full min-w-[480px]"
          role="img"
          aria-label="話数別 3面比較グラフ（実況コメント密度・Annict満足度・Xバズ）"
        >
          {/* Y グリッド */}
          {gridValues.map((v) => (
            <g key={v}>
              <line
                x1={PAD.left}
                x2={W - PAD.right}
                y1={cy(v)}
                y2={cy(v)}
                stroke={v === 0 ? "#c8ccd6" : "#e8eaef"}
                strokeWidth={1}
              />
              <text
                x={PAD.left - 7}
                y={cy(v) + 4}
                textAnchor="end"
                fontSize="10"
                fill="#8a909c"
              >
                {v}
              </text>
            </g>
          ))}

          {/* X 軸ラベル（話数） */}
          {points.map((p) => {
            // 話数が多い場合は間引く（8話超は偶数のみ、16話超は4の倍数のみ）
            const skip =
              maxEp > 16
                ? p.episodeIndex % 4 !== 0 && p.episodeIndex !== 1 && p.episodeIndex !== maxEp
                : maxEp > 8
                  ? p.episodeIndex % 2 !== 0 && p.episodeIndex !== 1
                  : false;
            if (skip) return null;
            return (
              <text
                key={p.episodeIndex}
                x={cx(p.episodeIndex, maxEp)}
                y={H - PAD.bottom + 16}
                textAnchor="middle"
                fontSize="10"
                fill="#8a909c"
              >
                {p.episodeIndex}話
              </text>
            );
          })}

          {/* 折れ線 */}
          {activeSeries.map((s) => {
            const d = makePath(points, s.key, maxEp);
            if (!d) return null;
            return (
              <g key={s.key}>
                <path
                  d={d}
                  fill="none"
                  stroke={s.color}
                  strokeWidth={2}
                  strokeDasharray={s.dashArray}
                  strokeLinejoin="round"
                  strokeLinecap="round"
                />
                {/* データ点（null でない点のみ）*/}
                {points.map((p) => {
                  const v = p[s.key];
                  if (v == null) return null;
                  return (
                    <circle
                      key={p.episodeIndex}
                      cx={cx(p.episodeIndex, maxEp)}
                      cy={cy(v)}
                      r={3}
                      fill="#fff"
                      stroke={s.color}
                      strokeWidth={1.8}
                    >
                      <title>{`${p.label} — ${s.label}: ${v}`}</title>
                    </circle>
                  );
                })}
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
}
