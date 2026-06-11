"use client";

import { useState } from "react";
import { MinuteHeatChart, type MinutePointInput, type PeakInput } from "./MinuteHeatChart";

/**
 * 作品別分析: ①話数別実況コメント数の棒グラフ ②話数を選んで全話の分単位盛り上がりグラフ。
 */

export interface RepresentativeCommentInput {
  minuteOffset: number;
  comments: { text: string; count: number }[];
}

export interface EpisodeHeatInput {
  programId: string;
  episodeLabel: string;
  channelName: string | null;
  startAt: string;
  totalComments: number;
  points: MinutePointInput[];
  peaks: PeakInput[];
  /** ピーク分の代表コメント。スナップショット未更新時は存在しない場合があるため optional。 */
  representativeComments?: RepresentativeCommentInput[];
}

function fmtDate(iso: string): string {
  // 放送はJST基準。サーバ(UTC)でレンダーすると深夜帯の放送日が1日ずれるため、
  // +9時間してから UTC ゲッターで月日を取り出す。
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "";
  const jst = new Date(t + 9 * 60 * 60 * 1000);
  return `${jst.getUTCMonth() + 1}/${jst.getUTCDate()}`;
}

const W = 760;
const H = 240;
const PAD = { top: 24, right: 16, bottom: 40, left: 50 };

export function EpisodeTrendChart({ episodes }: { episodes: EpisodeHeatInput[] }) {
  if (episodes.length === 0) return null;
  const max = Math.max(1, ...episodes.map((e) => e.totalComments));
  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;
  const step = innerW / episodes.length;
  const barW = Math.min(46, step * 0.6);

  return (
    <div className="overflow-x-auto">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full min-w-[480px]" role="img" aria-label="話数別実況コメント数">
        {[0, 0.5, 1].map((r) => (
          <line
            key={r}
            x1={PAD.left}
            x2={W - PAD.right}
            y1={PAD.top + innerH * (1 - r)}
            y2={PAD.top + innerH * (1 - r)}
            stroke="#e8eaef"
          />
        ))}
        <text x={PAD.left - 6} y={PAD.top + 4} textAnchor="end" fontSize="10" fill="#8a909c">
          {max.toLocaleString()}
        </text>
        <text x={PAD.left - 6} y={PAD.top + innerH + 4} textAnchor="end" fontSize="10" fill="#8a909c">
          0
        </text>
        {episodes.map((e, i) => {
          const h = (e.totalComments / max) * innerH;
          const cx = PAD.left + step * i + step / 2;
          return (
            <g key={e.programId}>
              <rect
                x={cx - barW / 2}
                y={PAD.top + innerH - h}
                width={barW}
                height={h}
                rx={3}
                fill="#2f6fdb"
                opacity={0.85}
              />
              <text x={cx} y={PAD.top + innerH - h - 5} textAnchor="middle" fontSize="10" fill="#454c59" fontWeight="bold">
                {e.totalComments.toLocaleString()}
              </text>
              <text x={cx} y={H - PAD.bottom + 15} textAnchor="middle" fontSize="10" fill="#454c59">
                {e.episodeLabel.replace(/^第/, "").replace(/話$/, "")}話
              </text>
              <text x={cx} y={H - PAD.bottom + 28} textAnchor="middle" fontSize="9" fill="#8a909c">
                {fmtDate(e.startAt)}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

export function EpisodeHeatSelector({ episodes }: { episodes: EpisodeHeatInput[] }) {
  const [selected, setSelected] = useState(episodes.length - 1); // 既定は最新話

  if (episodes.length === 0) {
    return <p className="text-sm text-muted py-6 text-center">実況データのある放送回がまだありません。</p>;
  }
  const cur = episodes[selected];
  const repComments = cur.representativeComments ?? [];

  return (
    <div>
      {/* 話数ピル（放送日つき） */}
      <div className="flex flex-wrap gap-1.5 mb-4">
        {episodes.map((e, i) => (
          <button
            key={e.programId}
            type="button"
            onClick={() => setSelected(i)}
            className={`flex flex-col items-center text-xs font-bold px-3 py-1.5 rounded-full transition leading-tight ${
              i === selected
                ? "bg-accent text-white"
                : "bg-surface border border-line text-ink-soft hover:border-line-strong"
            }`}
          >
            <span>{e.episodeLabel}</span>
            <span className={`font-normal tabular-nums ${i === selected ? "text-white/80" : "text-muted"}`}>
              {fmtDate(e.startAt)}
            </span>
          </button>
        ))}
      </div>

      <p className="text-xs text-muted mb-3 tabular-nums">
        {cur.episodeLabel}
        {cur.channelName && `（${cur.channelName}）`} ・ {fmtDate(cur.startAt)}放送 ・ 計
        {cur.totalComments.toLocaleString()}コメント
      </p>
      <MinuteHeatChart points={cur.points} peaks={cur.peaks} programId={cur.programId} />

      {/* 代表コメント（ピーク分） */}
      {repComments.length > 0 && (
        <div className="mt-5 border-t border-line pt-4">
          <p className="text-xs font-bold text-ink-soft mb-3">
            この回で多かったコメント
            <span className="ml-1.5 font-normal text-muted">（ニコニコ実況・ピーク時に集中したコメントの参考値）</span>
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {repComments.map((block) => (
              <div key={block.minuteOffset} className="rounded-lg border border-line bg-surface p-3">
                <p className="text-xs font-bold text-accent mb-2">▲ {block.minuteOffset}分ごろ</p>
                <ul className="space-y-1.5">
                  {block.comments.map((c, j) => (
                    <li
                      key={j}
                      className="text-xs text-ink-soft whitespace-pre-wrap break-words leading-relaxed"
                    >
                      「{c.text}」
                      {c.count > 1 && <span className="text-muted tabular-nums"> ×{c.count}</span>}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
