"use client";

/**
 * 話数を選択して X の反応（1話分）を閲覧するセレクター。
 * XBuzzSection（サーバーコンポーネント）から props として受け取り、
 * useStateでピル選択 → 選択話の volume/sentiment/topics + AI所感 + 投稿一覧 を表示する。
 */

import { useState } from "react";
import type { EpisodeXBuzz } from "@/lib/analytics/xbuzz";

/* ---------------------------------------------------------------- 型 */

interface XBuzzPost {
  statusId: string;
  url: string;
  text: string | null;
  postedAt: string;
  episodeId: string | null;
}

/* ---------------------------------------------------------------- sentiment chip */

function SentimentChip({ sentiment }: { sentiment: string | null }) {
  if (!sentiment) return null;
  const s = sentiment.toLowerCase();
  const config: { cls: string; label: string } | null =
    s === "positive"
      ? { cls: "bg-emerald-100 text-emerald-700", label: "ポジティブ" }
      : s === "mixed"
        ? { cls: "bg-amber-100 text-amber-700", label: "賛否両論" }
        : s === "negative"
          ? { cls: "bg-rose-100 text-rose-700", label: "ネガティブ" }
          : null;
  if (!config) return null;
  return (
    <span
      className={`inline-block text-[0.66rem] font-bold px-2 py-0.5 rounded-full whitespace-nowrap ${config.cls}`}
    >
      {config.label}
    </span>
  );
}

/* ---------------------------------------------------------------- volume gauge */

function VolumeGauge({ volume }: { volume: number }) {
  const filled = Math.max(0, Math.min(5, Math.round(volume)));
  return (
    <div className="flex items-center gap-0.5" aria-label={`盛り上がり ${filled}/5`}>
      {[0, 1, 2, 3, 4].map((i) => (
        <span
          key={i}
          className={`h-1.5 w-3 rounded-[2px] ${i < filled ? "bg-accent" : "bg-paper"}`}
        />
      ))}
    </div>
  );
}

/* ---------------------------------------------------------------- topic chips */

function TopicChips({ topics, max = 8 }: { topics: string[]; max?: number }) {
  const list = topics.slice(0, max);
  if (list.length === 0) return null;
  return (
    <ul className="flex flex-wrap gap-1.5">
      {list.map((t) => (
        <li
          key={t}
          className="text-[0.72rem] font-medium text-ink-soft bg-paper rounded-full px-2.5 py-0.5"
        >
          {t}
        </li>
      ))}
    </ul>
  );
}

/* ---------------------------------------------------------------- JST 日付ヘルパー */

function jstDateKey(iso: string): string | null {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  const jst = new Date(t + 9 * 60 * 60 * 1000);
  const y = jst.getUTCFullYear();
  const m = String(jst.getUTCMonth() + 1).padStart(2, "0");
  const d = String(jst.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/* ---------------------------------------------------------------- 投稿傾向 mini bar chart */

function EpisodePostsTrend({ posts }: { posts: XBuzzPost[] }) {
  if (posts.length === 0) return null;

  const counts = new Map<string, number>();
  for (const p of posts) {
    const key = jstDateKey(p.postedAt);
    if (!key) continue;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  if (counts.size === 0) return null;

  const total = posts.length;
  const sortedDays = [...counts.keys()].sort();

  if (total < 3 || sortedDays.length <= 1) {
    const peakDay = sortedDays.reduce(
      (best, k) => ((counts.get(k) ?? 0) > (counts.get(best) ?? 0) ? k : best),
      sortedDays[0],
    );
    const peakLabel = peakDay ? peakDay.slice(5).replace("-", "/") : null;
    return (
      <p className="text-[0.68rem] text-muted mt-1.5">
        投稿傾向: 計 <span className="font-bold text-ink-soft tabular-nums">{total}</span> 件
        {peakLabel ? `（${peakLabel}）` : ""}
      </p>
    );
  }

  const lastKey = sortedDays[sortedDays.length - 1];
  const firstKey = sortedDays[0];
  const lastMs = Date.parse(`${lastKey}T00:00:00Z`);
  const firstMs = Date.parse(`${firstKey}T00:00:00Z`);
  const daySpan = Math.round((lastMs - firstMs) / (24 * 60 * 60 * 1000)) + 1;
  const DAYS = Math.min(14, daySpan);

  const buckets: { key: string; label: string; count: number }[] = [];
  for (let i = DAYS - 1; i >= 0; i--) {
    const ms = lastMs - i * 24 * 60 * 60 * 1000;
    const d = new Date(ms);
    const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
    buckets.push({
      key,
      label: `${d.getUTCMonth() + 1}/${d.getUTCDate()}`,
      count: counts.get(key) ?? 0,
    });
  }

  const maxCount = Math.max(1, ...buckets.map((b) => b.count));
  const peakBucket = buckets.reduce((best, b) => (b.count > best.count ? b : best), buckets[0]);

  const W = 220;
  const BAR_H = 24;
  const LABEL_H = 12;
  const H = BAR_H + LABEL_H;
  const slot = W / buckets.length;
  const barW = Math.max(3, slot * 0.65);

  return (
    <div className="mt-1.5">
      <p className="text-[0.68rem] text-muted mb-0.5">
        投稿傾向: 計{" "}
        <span className="font-bold text-ink-soft tabular-nums">{total}</span> 件 ·
        ピーク {peakBucket.label}（{peakBucket.count}件）
      </p>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full max-w-[240px]"
        role="img"
        aria-label={`この話のX投稿傾向: 計${total}件`}
      >
        <line x1={0} x2={W} y1={BAR_H} y2={BAR_H} stroke="#e8eaef" strokeWidth={1} />
        {buckets.map((b, i) => {
          const h = maxCount > 0 ? (b.count / maxCount) * (BAR_H - 2) : 0;
          const x = i * slot + (slot - barW) / 2;
          const y = BAR_H - h;
          const isPeak = b.count === maxCount && maxCount > 0;
          return (
            <g key={b.key}>
              <rect
                x={x}
                y={y}
                width={barW}
                height={h}
                rx={1.5}
                fill="#2f6fdb"
                fillOpacity={b.count > 0 ? (isPeak ? 0.85 : 0.45) : 0}
              >
                <title>{`${b.label}: ${b.count}件`}</title>
              </rect>
              {(i === 0 || i === buckets.length - 1 || isPeak) && (
                <text
                  x={i * slot + slot / 2}
                  y={H - 1}
                  textAnchor="middle"
                  fontSize="8"
                  fill={isPeak ? "#2f6fdb" : "#8a909c"}
                >
                  {b.label}
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

/* ---------------------------------------------------------------- 投稿一覧 */

function EpisodePosts({ posts, max = 8 }: { posts: XBuzzPost[]; max?: number }) {
  const list = posts.filter((p) => p.text && p.text.trim().length > 0).slice(0, max);
  if (list.length === 0) return null;
  return (
    <ul className="mt-1.5 space-y-1.5">
      {list.map((p) => (
        <li key={p.statusId} className="text-[0.72rem] text-ink-soft leading-snug">
          <a
            href={p.url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary hover:underline underline-offset-2"
          >
            ▸
          </a>{" "}
          <span className="text-muted">
            {p.text!.length > 100 ? `${p.text!.slice(0, 100)}…` : p.text}
          </span>
        </li>
      ))}
    </ul>
  );
}

/* ---------------------------------------------------------------- メインコンポーネント */

interface EpisodeBuzzSelectorProps {
  /** 話数レベルのバズ一覧（新しい順が望ましい）。0件なら null を返す。 */
  episodes: EpisodeXBuzz[];
  /**
   * episodeId → XBuzzPost[] のルックアップ。
   * サーバーコンポーネントから渡す際は Map がシリアライズできないため、
   * Record<string, XBuzzPost[]> を受け取り内部で使う。
   */
  postsByEpisode: Record<string, XBuzzPost[]>;
}

export function EpisodeBuzzSelector({ episodes, postsByEpisode }: EpisodeBuzzSelectorProps) {
  // デフォルトは最新話（配列先頭 = 新しい順を前提）
  const [selectedIdx, setSelectedIdx] = useState(0);

  if (episodes.length === 0) return null;

  const ep = episodes[selectedIdx];
  const epPosts = ep.episodeId ? (postsByEpisode[ep.episodeId] ?? []) : [];
  const hasPosts = epPosts.some((p) => p.text && p.text.trim().length > 0);
  const hasPostData = epPosts.length > 0;

  return (
    <div>
      {/* 話数ピル（新しい順で表示） */}
      <div className="flex flex-wrap gap-1.5 mb-4">
        {episodes.map((e, i) => (
          <button
            key={`${e.episodeId ?? e.episodeLabel}-${i}`}
            type="button"
            onClick={() => setSelectedIdx(i)}
            className={`text-xs font-bold px-3 py-1 rounded-full transition ${
              i === selectedIdx
                ? "bg-accent text-white"
                : "bg-surface border border-line text-ink-soft hover:border-line-strong"
            }`}
          >
            {e.episodeLabel}
          </button>
        ))}
      </div>

      {/* 選択話の詳細 */}
      <div className="rounded-lg bg-paper/60 px-4 py-3 space-y-3">
        {/* volume + sentiment */}
        <div className="flex flex-wrap items-center gap-2.5">
          <span className="text-xs font-bold text-ink-soft">{ep.episodeLabel}</span>
          <VolumeGauge volume={ep.volume} />
          <span className="text-[0.68rem] font-bold text-muted tabular-nums">
            {Math.max(0, Math.min(5, Math.round(ep.volume)))}/5
          </span>
          <SentimentChip sentiment={ep.sentiment} />
        </div>

        {/* トピックチップ */}
        {ep.topics.length > 0 && (
          <TopicChips topics={ep.topics} max={8} />
        )}

        {/* AI所感（全文） */}
        {ep.summary && (
          <div className="rounded-md bg-paper px-3 py-2.5">
            <p className="text-[0.65rem] font-bold text-muted mb-1.5">AI所感（Grok要約）</p>
            <p className="text-[0.82rem] leading-relaxed text-ink-soft whitespace-pre-wrap">
              {ep.summary}
            </p>
          </div>
        )}

        {/* 投稿傾向（日別件数ミニグラフ） */}
        {hasPostData && <EpisodePostsTrend posts={epPosts} />}

        {/* 投稿一覧（最大8件） */}
        {hasPosts && (
          <div>
            <p className="text-[0.65rem] font-bold text-muted mb-0.5">投稿事例（最大8件）</p>
            <EpisodePosts posts={epPosts} max={8} />
          </div>
        )}

        {/* 投稿もsummaryも無い話のフォールバック */}
        {!ep.summary && !hasPostData && (
          <p className="text-[0.72rem] text-muted">この話のデータはまだありません。</p>
        )}
      </div>
    </div>
  );
}
