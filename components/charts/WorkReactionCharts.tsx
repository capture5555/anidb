import type {
  WorkReactionBreakdown,
  EpisodeReactionMix,
  WorkMoment,
} from "@/lib/analytics/workReactions";
import { REACTION_META } from "./reactions";

/**
 * 作品別リアクション分析の表示部品（静的SVG/マークアップ）。
 * 色とラベルは MinuteHeatChart の REACTION_META を共用する。
 * 構成比（share）= リアクション該当の延べ数に対する割合（スタックで1）。
 * 該当率（mentionRate）= コメント総数に対する割合（重複ありで合計1超もありうる）。
 */

const META = Object.fromEntries(REACTION_META.map((m) => [m.key, m])) as Record<
  string,
  { key: string; label: string; color: string }
>;

const fmtPct = (share: number): string => (share * 100).toFixed(1);

// ---------------------------------------------------------------- ① 全体の構成比バー

export function ReactionCompositionBar({ breakdown }: { breakdown: WorkReactionBreakdown }) {
  const visible = breakdown.overall.filter((r) => r.share > 0);

  return (
    <div>
      {breakdown.dominant && (
        <p className="text-xs text-ink-soft mb-2.5">
          この作品は「{META[breakdown.dominant.category].label}」のリアクションが最多（構成比
          {fmtPct(breakdown.dominant.share)}%）
        </p>
      )}

      {/* 100%積み上げ横バー */}
      <div className="flex w-full h-7 rounded-md overflow-hidden border border-line">
        {breakdown.overall.map((r) => (
          <div
            key={r.category}
            style={{ width: `${r.share * 100}%`, backgroundColor: META[r.category].color }}
            title={`${META[r.category].label} ${fmtPct(r.share)}%（コメントの${fmtPct(
              r.mentionRate,
            )}%が該当）`}
          />
        ))}
      </div>

      {/* 凡例（share>0 のみ。色だけに頼らずラベル併記） */}
      <ul className="flex flex-wrap gap-x-4 gap-y-1 mt-3">
        {visible.map((r) => (
          <li
            key={r.category}
            className="inline-flex items-center gap-1.5 text-xs text-ink-soft tabular-nums"
          >
            <span
              className="inline-block w-2.5 h-2.5 rounded-[2px]"
              style={{ backgroundColor: META[r.category].color }}
            />
            {META[r.category].label} {fmtPct(r.share)}%
          </li>
        ))}
      </ul>

      <p className="text-[0.62rem] text-muted mt-2.5 leading-relaxed">
        ※ 1コメントが複数のリアクションに該当する場合があり、構成比はリアクション該当の延べ数（
        {breakdown.totalReactionHits.toLocaleString()}件）に対する割合です。
      </p>
    </div>
  );
}

// ---------------------------------------------------------------- ② 話数別の構成比推移

const W = 760;
const H = 220;
const PAD = { top: 16, right: 16, bottom: 44, left: 16 };

export function EpisodeReactionTrend({ perEpisode }: { perEpisode: EpisodeReactionMix[] }) {
  if (perEpisode.length < 2) return null;

  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;
  const step = innerW / perEpisode.length;
  const barW = Math.min(46, step * 0.6);

  return (
    <div>
      <div className="overflow-x-auto">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="w-full min-w-[480px]"
          role="img"
          aria-label="話数別リアクション構成比"
        >
          {perEpisode.map((ep, i) => {
            const cx = PAD.left + step * i + step / 2;
            const hasData = ep.shares.some((s) => s.share > 0);
            const shortLabel = ep.episodeLabel.replace(/^第/, "").replace(/話$/, "") + "話";

            if (!hasData) {
              return (
                <g key={i}>
                  <rect
                    x={cx - barW / 2}
                    y={PAD.top}
                    width={barW}
                    height={innerH}
                    rx={3}
                    fill="#eef0f4"
                  />
                  <text x={cx} y={H - PAD.bottom + 15} textAnchor="middle" fontSize="10" fill="#454c59">
                    {shortLabel}
                  </text>
                  <text x={cx} y={H - PAD.bottom + 28} textAnchor="middle" fontSize="9" fill="#8a909c">
                    {ep.totalComments.toLocaleString()}
                  </text>
                </g>
              );
            }

            let yCursor = PAD.top + innerH;
            const segs = ep.shares
              .filter((s) => s.share > 0)
              .map((s) => {
                const h = s.share * innerH;
                yCursor -= h;
                return { y: yCursor, h, share: s.share, category: s.category };
              });

            return (
              <g key={i}>
                {segs.map((s) => (
                  <rect
                    key={s.category}
                    x={cx - barW / 2}
                    y={s.y}
                    width={barW}
                    height={s.h}
                    fill={META[s.category].color}
                  >
                    <title>{`${ep.episodeLabel} ${META[s.category].label} ${fmtPct(s.share)}%`}</title>
                  </rect>
                ))}
                <text x={cx} y={H - PAD.bottom + 15} textAnchor="middle" fontSize="10" fill="#454c59">
                  {shortLabel}
                </text>
                <text x={cx} y={H - PAD.bottom + 28} textAnchor="middle" fontSize="9" fill="#8a909c">
                  {ep.totalComments.toLocaleString()}
                </text>
              </g>
            );
          })}
        </svg>
      </div>

      {/* 凡例 */}
      <ul className="flex flex-wrap gap-x-4 gap-y-1 mt-3">
        {REACTION_META.map((c) => (
          <li key={c.key} className="inline-flex items-center gap-1.5 text-xs text-ink-soft">
            <span className="inline-block w-2.5 h-2.5 rounded-[2px]" style={{ backgroundColor: c.color }} />
            {c.label}
          </li>
        ))}
      </ul>

      <p className="text-[0.62rem] text-muted mt-2 leading-relaxed">
        各話100%の構成比。下の数字はコメント総数（量の目安）。コメント数が少ない話は構成比のブレが大きい点に注意。
      </p>
    </div>
  );
}

// ---------------------------------------------------------------- ③ 名場面リスト

export function WorkMomentsList({ moments }: { moments: WorkMoment[] }) {
  if (moments.length === 0) return null;

  return (
    <ol className="divide-y divide-line">
      {moments.map((m, i) => (
        <li key={`${m.episodeLabel}-${m.minute}`} className="flex items-center gap-3 py-2.5">
          <span
            className={`w-6 text-center font-black tabular-nums shrink-0 ${
              i < 3 ? "text-accent" : "text-muted"
            }`}
          >
            {i + 1}
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm text-ink truncate">
              <span className="font-bold">{m.episodeLabel}</span>
              <span className="text-ink-soft ml-1.5">開始{m.minute}分ごろ</span>
              {m.isSpike && (
                <span className="ml-2 inline-flex items-center gap-0.5 rounded-full bg-accent/10 px-1.5 py-0.5 text-[0.62rem] font-bold text-accent tabular-nums align-middle">
                  ★神シーン
                  <span className="text-[0.58rem] font-medium opacity-80">z{m.z.toFixed(1)}</span>
                </span>
              )}
            </p>
            {m.comments.length > 0 && (
              <p className="text-xs text-muted truncate">
                {m.comments.map((c) => `「${c.text}」`).join(" ")}
              </p>
            )}
          </div>
          <span className="shrink-0 text-right">
            <span className="block font-black text-accent tabular-nums">{m.total.toLocaleString()}</span>
            <span className="block text-[0.62rem] text-muted">コメ/分</span>
          </span>
        </li>
      ))}
    </ol>
  );
}
