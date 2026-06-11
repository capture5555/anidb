"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import {
  RECOMMENDED_CHANNELS,
  CHANNELS_COOKIE,
  serializeChannelsCookie,
} from "@/lib/channels";

/**
 * 「視聴できる放送局」の複数選択（おすすめ順）。地域セレクタの置き換え。
 * - 番組表 / この後の放送 / カレンダーフィードの既定を駆動する。
 * - ログアウト時: Cookie(pref_channels, カンマ区切り)に保存。
 * - ログイン時: PUT /api/me/channels で保存（Cookieにも保存しサーバー描画へ即反映）。
 * 変更時はサーバーコンポーネントを再取得（router.refresh）する。
 */
export function ChannelSelector({
  initial,
  loggedIn = false,
}: {
  initial: string[];
  loggedIn?: boolean;
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(() => new Set(initial));
  const [pending, startTransition] = useTransition();

  const count = selected.size;

  const persist = (next: Set<string>) => {
    const list = RECOMMENDED_CHANNELS.filter((c) => next.has(c)); // おすすめ順を保つ
    const cookie = serializeChannelsCookie(list);
    document.cookie = `${CHANNELS_COOKIE}=${encodeURIComponent(
      cookie,
    )}; path=/; max-age=${60 * 60 * 24 * 365}; samesite=lax`;
    if (loggedIn) {
      fetch("/api/me/channels", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channels: list }),
      }).catch(() => {});
    }
    startTransition(() => router.refresh());
  };

  const toggle = (name: string) => {
    const next = new Set(selected);
    if (next.has(name)) next.delete(name);
    else next.add(name);
    setSelected(next);
    persist(next);
  };

  const clearAll = () => {
    const next = new Set<string>();
    setSelected(next);
    persist(next);
  };

  const summary = useMemo(() => {
    if (count === 0) return "未選択（配信以外の全放送局を表示）";
    return `${count}局を選択中`;
  }, [count]);

  return (
    <details className="group">
      <summary className="inline-flex cursor-pointer list-none items-center gap-1.5 text-xs text-muted">
        <span className="font-bold text-ink-soft">視聴できる放送局</span>
        <span className="rounded-md bg-paper px-2 py-1 font-medium text-ink-soft">
          {summary}
        </span>
        <span className="text-muted transition group-open:rotate-180">▾</span>
      </summary>

      <div className="mt-2 w-72 max-w-[90vw] rounded-md border border-line bg-surface p-2 shadow-sm">
        <div className="mb-1.5 flex items-center justify-between px-1">
          <span className="text-[0.7rem] text-muted">おすすめ順</span>
          {count > 0 && (
            <button
              type="button"
              onClick={clearAll}
              disabled={pending}
              className="text-[0.7rem] font-bold text-primary hover:underline disabled:opacity-50"
            >
              すべて解除
            </button>
          )}
        </div>
        <ul className="max-h-72 space-y-0.5 overflow-y-auto pr-1">
          {RECOMMENDED_CHANNELS.map((name) => {
            const checked = selected.has(name);
            return (
              <li key={name}>
                <label
                  className={`flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-xs transition hover:bg-paper ${
                    checked ? "font-bold text-ink" : "text-ink-soft"
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggle(name)}
                    disabled={pending}
                    className="accent-primary"
                  />
                  {name}
                </label>
              </li>
            );
          })}
        </ul>
      </div>
    </details>
  );
}
