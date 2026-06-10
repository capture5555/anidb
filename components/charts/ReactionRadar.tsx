import type { ReactionCategory } from "@/lib/analytics/commentAnalysis";
import { REACTION_ORDER } from "@/lib/analytics/workReactions";
import { radarPoints } from "@/lib/analytics/reactionFingerprint";
import { REACTION_META } from "./reactions";

/**
 * リアクション指紋レーダー（この作品 vs クール平均）。静的SVG・サーバーコンポーネント。
 *
 * 6軸（REACTION_ORDER）。各軸はカテゴリ別の構成比を、
 * maxAxis = 全カテゴリの max(workShare, cohortShare) で割って正規化する
 * （最大の軸がリムに届く＝小さいカテゴリも潰れずに見える）。
 */

const META = Object.fromEntries(REACTION_META.map((m) => [m.key, m])) as Record<
  string,
  { key: string; label: string; color: string }
>;

const ACCENT = "#2f6fdb";
const COHORT = "#8a909c";

const SIZE = 260;
const CX = SIZE / 2;
const CY = SIZE / 2;
const R = 92;

export function ReactionRadar({
  workShares,
  cohortShares,
}: {
  workShares: { category: ReactionCategory; share: number }[];
  cohortShares: Record<ReactionCategory, number>;
}) {
  const shareByCat = new Map(workShares.map((s) => [s.category, s.share]));
  const work = REACTION_ORDER.map((c) => shareByCat.get(c) ?? 0);
  const cohort = REACTION_ORDER.map((c) => cohortShares[c] ?? 0);

  const maxAxis = Math.max(
    ...REACTION_ORDER.map((_, i) => Math.max(work[i], cohort[i])),
    0,
  );
  if (maxAxis <= 0) return null;

  const workNorm = work.map((v) => v / maxAxis);
  const cohortNorm = cohort.map((v) => v / maxAxis);

  const workPts = radarPoints(workNorm, CX, CY, R);
  const cohortPts = radarPoints(cohortNorm, CX, CY, R);

  // 軸線・グリッド（同心ヘキサゴン）
  const gridRings = [0.25, 0.5, 0.75, 1].map((f) =>
    radarPoints(REACTION_ORDER.map(() => f), CX, CY, R),
  );
  const axisEnds = REACTION_ORDER.map((_, i) => {
    const angle = -Math.PI / 2 + (2 * Math.PI * i) / REACTION_ORDER.length;
    return { x: CX + R * Math.cos(angle), y: CY + R * Math.sin(angle) };
  });
  const labelPos = REACTION_ORDER.map((_, i) => {
    const angle = -Math.PI / 2 + (2 * Math.PI * i) / REACTION_ORDER.length;
    return { x: CX + (R + 16) * Math.cos(angle), y: CY + (R + 16) * Math.sin(angle) };
  });

  // インサイト: cohortShare>0 のカテゴリで work/cohort 比が最大のもの
  const topInsight = REACTION_ORDER.reduce<{ label: string; ratio: number } | null>(
    (best, c, i) => {
      if (cohort[i] <= 0) return best;
      const ratio = work[i] / cohort[i];
      return best == null || ratio > best.ratio ? { label: META[c].label, ratio } : best;
    },
    null,
  );

  return (
    <div>
      <div className="flex justify-center">
        <svg
          viewBox={`0 0 ${SIZE} ${SIZE}`}
          className="w-full max-w-[300px]"
          role="img"
          aria-label="リアクション指紋（この作品とクール平均の比較）"
        >
          {/* グリッド */}
          {gridRings.map((pts, i) => (
            <polygon key={i} points={pts} fill="none" stroke="#eef0f4" strokeWidth={1} />
          ))}
          {axisEnds.map((p, i) => (
            <line key={i} x1={CX} y1={CY} x2={p.x} y2={p.y} stroke="#eef0f4" strokeWidth={1} />
          ))}

          {/* クール平均（グレー破線・塗りなし） */}
          <polygon
            points={cohortPts}
            fill="none"
            stroke={COHORT}
            strokeWidth={1.5}
            strokeDasharray="4 3"
          />
          {/* この作品（アクセント塗り＋線） */}
          <polygon points={workPts} fill={ACCENT} fillOpacity={0.25} stroke={ACCENT} strokeWidth={2} />

          {/* 軸ラベル */}
          {labelPos.map((p, i) => (
            <text
              key={i}
              x={p.x}
              y={p.y}
              textAnchor="middle"
              dominantBaseline="middle"
              fontSize="11"
              fill="#454c59"
            >
              {META[REACTION_ORDER[i]].label}
            </text>
          ))}
        </svg>
      </div>

      {/* 凡例 */}
      <ul className="flex flex-wrap justify-center gap-x-5 gap-y-1 mt-2">
        <li className="inline-flex items-center gap-1.5 text-xs text-ink-soft">
          <span
            className="inline-block w-3 h-3 rounded-[2px]"
            style={{ backgroundColor: ACCENT, opacity: 0.4 }}
          />
          この作品
        </li>
        <li className="inline-flex items-center gap-1.5 text-xs text-ink-soft">
          <span
            className="inline-block w-3 border-t-2 border-dashed"
            style={{ borderColor: COHORT }}
          />
          クール平均
        </li>
      </ul>

      {topInsight && (
        <p className="text-xs text-accent text-center mt-2 tabular-nums">
          クール平均比で「{topInsight.label}」が突出（{topInsight.ratio.toFixed(1)}倍）
        </p>
      )}
    </div>
  );
}
