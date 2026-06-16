"use client";

import { useCallback, useState } from "react";
import { REACTION_META, OTHER_COLOR } from "./reactions";

/**
 * 分単位コメント数の積み上げ棒グラフ（リアクション分類つき）＋ピーク代表コメント。
 * REGZA(TimeOn)の「盛り上がり山型グラフ」風。母数はニコニコ実況のコメント数。
 */

export interface MinutePointInput {
  minute: number;
  total: number;
  reactions: Partial<Record<string, number>>;
}
export interface PeakInput {
  minute: number;
  comments: { text: string; count: number }[];
}

// 後方互換: 既存の import 元（"./MinuteHeatChart"）からも参照できるよう再エクスポート
export { REACTION_META };

const W = 760;
const H = 300;
const PAD = { top: 26, right: 16, bottom: 30, left: 44 };

interface MinuteComments {
  minute: number;
  loading: boolean;
  total: number;
  truncated: boolean;
  comments: { text: string; sec: number }[];
}

export function MinuteHeatChart({
  points,
  peaks,
  programId,
}: {
  points: MinutePointInput[];
  peaks: PeakInput[];
  /** 指定すると、棒をクリックでその分の実況コメントを表示できる */
  programId?: string;
}) {
  const [tip, setTip] = useState<{ x: number; y: number; minute: number } | null>(null);
  const [sel, setSel] = useState<MinuteComments | null>(null);

  const openMinute = useCallback(
    async (minute: number) => {
      if (!programId) return;
      setSel({ minute, loading: true, total: 0, truncated: false, comments: [] });
      try {
        const res = await fetch(
          `/api/analytics/minute-comments?programId=${encodeURIComponent(programId)}&minute=${minute}`,
        );
        const data = await res.json();
        setSel({
          minute,
          loading: false,
          total: data.total ?? 0,
          truncated: Boolean(data.truncated),
          comments: data.comments ?? [],
        });
      } catch {
        setSel({ minute, loading: false, total: 0, truncated: false, comments: [] });
      }
    },
    [programId],
  );

  if (points.length === 0) return null;

  const maxTotal = Math.max(1, ...points.map((p) => p.total));
  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;
  const barW = Math.min(18, (innerW / points.length) * 0.82);
  const x = (m: number) => PAD.left + (m / Math.max(1, points.length - 1)) * innerW;
  const yScale = (v: number) => (v / maxTotal) * innerH;

  const peakMinutes = new Set(peaks.map((p) => p.minute));
  const tipPoint = tip ? points[tip.minute] : null;

  // Yグリッド: 0, 1/2, max
  const gridVals = [0, Math.round(maxTotal / 2), maxTotal];

  return (
    <div className="relative">
      <div className="overflow-x-auto">
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full min-w-[560px]" role="img" aria-label="分単位の盛り上がりグラフ">
          {gridVals.map((v) => (
            <g key={v}>
              <line
                x1={PAD.left}
                x2={W - PAD.right}
                y1={H - PAD.bottom - yScale(v)}
                y2={H - PAD.bottom - yScale(v)}
                stroke="#e8eaef"
              />
              <text
                x={PAD.left - 6}
                y={H - PAD.bottom - yScale(v) + 4}
                textAnchor="end"
                fontSize="10"
                fill="#8a909c"
              >
                {v.toLocaleString()}
              </text>
            </g>
          ))}

          {/* X軸（5分刻みラベル） */}
          {points
            .filter((p) => p.minute % 5 === 0)
            .map((p) => (
              <text
                key={p.minute}
                x={x(p.minute)}
                y={H - PAD.bottom + 16}
                textAnchor="middle"
                fontSize="10"
                fill="#8a909c"
              >
                {p.minute}分
              </text>
            ))}

          {/* 積み上げ棒 */}
          {points.map((p) => {
            const catSum = REACTION_META.reduce((acc, c) => acc + (p.reactions[c.key] ?? 0), 0);
            // 1コメントが複数カテゴリに当たることがあるため、合計が総数を超えたら比例縮小
            const scale = catSum > p.total && catSum > 0 ? p.total / catSum : 1;
            let yCursor = H - PAD.bottom;
            const segs: { color: string; h: number }[] = [];
            for (const c of REACTION_META) {
              const v = (p.reactions[c.key] ?? 0) * scale;
              if (v > 0) segs.push({ color: c.color, h: yScale(v) });
            }
            const otherH = Math.max(0, yScale(p.total) - segs.reduce((a, s) => a + s.h, 0));
            const isPeak = peakMinutes.has(p.minute);
            const isSel = sel?.minute === p.minute;
            return (
              <g
                key={p.minute}
                style={{ cursor: programId ? "pointer" : "default" }}
                onMouseEnter={(e) => {
                  const rect = (e.currentTarget as SVGElement).closest("svg")!.getBoundingClientRect();
                  setTip({ x: (x(p.minute) / W) * rect.width, y: 30, minute: p.minute });
                }}
                onMouseLeave={() => setTip(null)}
                onClick={() => openMinute(p.minute)}
              >
                {isSel && (
                  <rect
                    x={x(p.minute) - barW / 2 - 1.5}
                    y={PAD.top}
                    width={barW + 3}
                    height={innerH}
                    fill="#2f6fdb"
                    opacity={0.1}
                  />
                )}
                {/* 当たり判定を広く */}
                <rect x={x(p.minute) - barW / 2 - 1} y={PAD.top} width={barW + 2} height={innerH} fill="transparent" />
                {/* その他（未分類）が一番下 */}
                {otherH > 0 && (
                  <rect
                    x={x(p.minute) - barW / 2}
                    y={(yCursor -= otherH)}
                    width={barW}
                    height={otherH}
                    fill={OTHER_COLOR}
                  />
                )}
                {segs.map((s, i) => (
                  <rect
                    key={i}
                    x={x(p.minute) - barW / 2}
                    y={(yCursor -= s.h)}
                    width={barW}
                    height={s.h}
                    fill={s.color}
                  />
                ))}
                {isPeak && (
                  <text x={x(p.minute)} y={yCursor - 6} textAnchor="middle" fontSize="11" fill="#e8482f" fontWeight="bold">
                    ▲
                  </text>
                )}
              </g>
            );
          })}
        </svg>
      </div>

      {programId && (
        <p className="text-[0.7rem] text-muted mt-1">
          棒をクリックすると、その分に流れた実況コメントが見られます。
        </p>
      )}

      {/* 選択した分のコメント一覧 */}
      {programId && sel && (
        <div className="mt-3 rounded-lg border border-line bg-paper/50 p-3">
          <div className="flex items-center justify-between gap-2 mb-2">
            <p className="text-xs font-bold text-ink">
              {sel.minute}分ごろのコメント
              {!sel.loading && (
                <span className="text-muted font-normal ml-1.5">
                  {sel.total.toLocaleString()}件{sel.truncated && "以上"}
                </span>
              )}
            </p>
            <button
              onClick={() => setSel(null)}
              className="text-muted hover:text-ink text-sm leading-none"
              aria-label="閉じる"
            >
              ×
            </button>
          </div>
          {sel.loading ? (
            <p className="text-xs text-muted py-3 text-center">読み込み中…</p>
          ) : sel.comments.length === 0 ? (
            <p className="text-xs text-muted py-3 text-center">この分のコメントは記録されていません。</p>
          ) : (
            <ul className="max-h-56 overflow-y-auto space-y-0.5 pr-1">
              {sel.comments.map((c, i) => (
                <li key={i} className="text-xs text-ink-soft flex gap-2 leading-relaxed">
                  <span className="text-muted tabular-nums shrink-0 w-8 text-right">
                    {sel.minute}:{String(c.sec).padStart(2, "0")}
                  </span>
                  <span className="min-w-0 break-words">{c.text}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* ツールチップ */}
      {tipPoint && tip && (
        <div
          className="pointer-events-none absolute z-10 rounded-md bg-[#1b1f27] text-white text-xs px-3 py-2 shadow-lg"
          style={{ left: Math.max(0, tip.x - 70), top: tip.y }}
        >
          <p className="font-bold tabular-nums">
            {tipPoint.minute}分 ／ {tipPoint.total.toLocaleString()}コメント
          </p>
          {REACTION_META.filter((c) => (tipPoint.reactions[c.key] ?? 0) > 0).map((c) => (
            <p key={c.key} className="tabular-nums">
              <span className="inline-block w-2 h-2 rounded-[2px] mr-1.5" style={{ backgroundColor: c.color }} />
              {c.label} {tipPoint.reactions[c.key]}
            </p>
          ))}
        </div>
      )}

      {/* 凡例 */}
      <ul className="flex flex-wrap gap-x-4 gap-y-1 mt-3">
        {REACTION_META.map((c) => (
          <li key={c.key} className="inline-flex items-center gap-1.5 text-xs text-ink-soft">
            <span className="inline-block w-2.5 h-2.5 rounded-[2px]" style={{ backgroundColor: c.color }} />
            {c.label}
          </li>
        ))}
        <li className="inline-flex items-center gap-1.5 text-xs text-ink-soft">
          <span className="inline-block w-2.5 h-2.5 rounded-[2px]" style={{ backgroundColor: OTHER_COLOR }} />
          その他
        </li>
      </ul>

      {/* ピークの代表コメント */}
      {peaks.length > 0 && (
        <div className="mt-4 grid grid-cols-1 sm:grid-cols-3 gap-3">
          {peaks.map((p) => (
            <div key={p.minute} className="rounded-lg border border-line bg-surface p-3">
              <p className="text-xs font-bold text-accent mb-1.5">▲ {p.minute}分ごろ</p>
              <ul className="space-y-1">
                {p.comments.slice(0, 4).map((c, i) => (
                  <li key={i} className="text-xs text-ink-soft flex justify-between gap-2">
                    <span className="truncate">「{c.text}」</span>
                    <span className="text-muted tabular-nums shrink-0">×{c.count}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
