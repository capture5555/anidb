"use client";

import { useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { MinuteHeatChart, type MinutePointInput, type PeakInput } from "./MinuteHeatChart";

/** 盛り上がった放送回ランキング：左で番組を選ぶと右にREGZA風の分単位グラフを表示 */

export interface HotProgramInput {
  programId: string;
  workId: string;
  workTitle: string;
  posterUrl: string | null;
  episodeLabel: string | null;
  channelName: string | null;
  startAt: string;
  totalComments: number;
  points: MinutePointInput[];
  peaks: PeakInput[];
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export function HotProgramsPanel({ programs }: { programs: HotProgramInput[] }) {
  const [selected, setSelected] = useState(0);

  if (programs.length === 0) {
    return (
      <p className="text-sm text-muted py-8 text-center">
        データ収集中です。放送後のコメントログが貯まると表示されます。
      </p>
    );
  }
  const cur = programs[selected];

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[300px_1fr] gap-6">
      {/* ランキングリスト */}
      <ol className="space-y-1.5">
        {programs.map((p, i) => (
          <li key={p.programId}>
            <button
              type="button"
              onClick={() => setSelected(i)}
              className={`w-full flex items-center gap-3 rounded-lg border p-2 text-left transition ${
                i === selected
                  ? "border-accent bg-accent/5"
                  : "border-line bg-surface hover:border-line-strong"
              }`}
            >
              <span className={`shrink-0 w-6 text-center font-bold tabular-nums ${i < 3 ? "text-accent" : "text-muted"}`}>
                {i + 1}
              </span>
              <span className="relative shrink-0 w-9 h-12 rounded overflow-hidden bg-paper-deep">
                {p.posterUrl && (
                  <Image src={p.posterUrl} alt="" fill className="object-cover" sizes="36px" />
                )}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[0.82rem] font-bold text-ink leading-snug truncate">
                  {p.workTitle}
                </span>
                <span className="block text-xs text-muted truncate">
                  {p.episodeLabel ?? ""} ・ {formatDate(p.startAt)}
                </span>
                <span className="block text-xs text-accent font-bold tabular-nums">
                  {p.totalComments.toLocaleString()}コメント
                </span>
              </span>
            </button>
          </li>
        ))}
      </ol>

      {/* 選択中のグラフ */}
      <div className="min-w-0">
        <div className="flex items-baseline justify-between gap-3 mb-2 flex-wrap">
          <p className="font-bold text-ink">
            <Link href={`/works/${cur.workId}`} className="hover:text-accent transition">
              {cur.workTitle}
            </Link>
            <span className="text-ink-soft font-normal text-sm ml-2">
              {cur.episodeLabel} {cur.channelName && `（${cur.channelName}）`}
            </span>
          </p>
          <p className="text-xs text-muted tabular-nums">
            {formatDate(cur.startAt)}放送 ・ 計{cur.totalComments.toLocaleString()}コメント
          </p>
        </div>
        <MinuteHeatChart points={cur.points} peaks={cur.peaks} />
      </div>
    </div>
  );
}
