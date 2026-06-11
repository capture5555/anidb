"use client";
/**
 * AIコメント履歴の「矢印送り」インラインコンポーネント。
 *
 * props:
 *   items — {body, generatedAt, title?}[] 新しい順（index 0 が最新）
 *
 * - 最新を初期表示し、←/→ で過去↔最新を辿れる
 * - 現在位置（例 1/5）と生成日時(JST)を表示
 * - items が 1 件なら矢印は非表示
 * - items が空なら何も出さない
 */

import { useState } from "react";

export interface AiCommentStepperItem {
  body: string;
  generatedAt: string;
  title?: string | null;
}

function formatJst(iso: string): string {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleString("ja-JP", {
      timeZone: "Asia/Tokyo",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

export function AiCommentStepper({ items }: { items: AiCommentStepperItem[] }) {
  const [index, setIndex] = useState(0);

  if (items.length === 0) return null;

  const item = items[index]!;
  const total = items.length;
  const hasPrev = index < total - 1; // 過去方向（index が大きいほど古い）
  const hasNext = index > 0; // 新しい方向

  return (
    <div>
      {/* 日時 + 位置インジケータ */}
      {(item.generatedAt || total > 1) && (
        <div className="flex items-center gap-2 mb-1.5 flex-wrap text-[0.66rem] text-muted">
          {item.title && <span>{item.title}</span>}
          {item.generatedAt && (
            <span>{formatJst(item.generatedAt)} 生成</span>
          )}
          {total > 1 && (
            <span className="font-bold tabular-nums">
              {index + 1}/{total}
            </span>
          )}
        </div>
      )}

      {/* 本文 */}
      <p className="text-[0.9rem] leading-[1.8] text-ink-soft whitespace-pre-wrap">
        {item.body}
      </p>

      {/* ナビゲーション矢印（2件以上のときのみ） */}
      {total > 1 && (
        <div className="flex items-center gap-2 mt-3 pt-2.5 border-t border-line">
          <button
            type="button"
            onClick={() => setIndex((i) => Math.min(i + 1, total - 1))}
            disabled={!hasPrev}
            aria-label="前のコメント"
            className={`text-xs font-bold px-3 py-1 rounded-full transition ${
              hasPrev
                ? "bg-surface border border-line text-ink-soft hover:border-line-strong hover:text-ink"
                : "bg-surface border border-line text-line cursor-not-allowed"
            }`}
          >
            ← 前のコメント
          </button>
          <button
            type="button"
            onClick={() => setIndex((i) => Math.max(i - 1, 0))}
            disabled={!hasNext}
            aria-label="次のコメント（新しい）"
            className={`text-xs font-bold px-3 py-1 rounded-full transition ${
              hasNext
                ? "bg-surface border border-line text-ink-soft hover:border-line-strong hover:text-ink"
                : "bg-surface border border-line text-line cursor-not-allowed"
            }`}
          >
            次へ →
          </button>
        </div>
      )}
    </div>
  );
}
