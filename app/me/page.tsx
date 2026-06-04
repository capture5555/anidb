"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

interface SubRow {
  id: string;
  work_id: string;
  google_calendar_id: string;
  mode: string;
  status: string;
  works?: { title: string };
}

export default function MyPage() {
  const [state, setState] = useState<"loading" | "demo" | "need-auth" | "ready" | "error">("loading");
  const [subs, setSubs] = useState<SubRow[]>([]);

  const load = async () => {
    setState("loading");
    try {
      const res = await fetch("/api/subscriptions");
      if (res.status === 401) return setState("need-auth");
      if (!res.ok) return setState("error");
      const data = await res.json();
      if (data.demo) return setState("demo");
      setSubs(data.subscriptions ?? []);
      setState("ready");
    } catch {
      setState("error");
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const unsubscribe = async (id: string) => {
    if (!confirm("この登録を解除しますか？（カレンダー上の予定は残ります）")) return;
    await fetch(`/api/subscriptions/${id}`, { method: "DELETE" });
    void load();
  };

  return (
    <div className="mx-auto max-w-3xl px-5 sm:px-8 py-12">
      <p className="kicker">My list</p>
      <h1 className="display text-3xl mt-3">登録した作品</h1>

      <div className="mt-8">
        {state === "loading" && <p className="text-muted text-sm">読み込み中…</p>}

        {state === "need-auth" && (
          <div className="border border-line rounded-[var(--radius-card)] p-6 bg-surface">
            <p className="text-ink-soft text-sm leading-relaxed">
              登録した作品を表示するには、Googleでのログインが必要です。
            </p>
            <a
              href="/api/auth/google/start?returnTo=/me"
              className="inline-block mt-4 bg-ink text-paper px-5 py-2.5 rounded-[var(--radius-card)] text-sm hover:opacity-90 transition"
            >
              Googleでログイン
            </a>
          </div>
        )}

        {state === "demo" && (
          <div className="border border-[var(--color-info)]/30 bg-[var(--color-info)]/8 rounded-[var(--radius-card)] p-6">
            <p className="text-sm text-ink-soft leading-relaxed">
              現在はデモモード（Google連携が未設定）です。Google連携を設定すると、ここに登録済みの作品が一覧表示され、登録の解除などができます。
            </p>
            <Link href="/" className="inline-block mt-4 text-sm link-underline">
              作品一覧へ戻る
            </Link>
          </div>
        )}

        {state === "ready" && subs.length === 0 && (
          <div className="py-16 text-center">
            <p className="display text-xl">まだ登録がありません</p>
            <p className="text-sm text-muted mt-2">
              作品ページの「Googleカレンダーへ追加」から登録できます。
            </p>
            <Link
              href="/"
              className="inline-block mt-6 border border-line-strong px-5 py-2 rounded-[var(--radius-card)] text-sm hover:bg-paper-deep transition"
            >
              作品を探す
            </Link>
          </div>
        )}

        {state === "ready" && subs.length > 0 && (
          <ul className="divide-y divide-line border-y border-line">
            {subs.map((s) => (
              <li key={s.id} className="flex items-center justify-between gap-4 py-4">
                <div>
                  <Link href={`/works/${s.work_id}`} className="display text-lg hover:text-accent transition">
                    {s.works?.title ?? "(作品)"}
                  </Link>
                  <p className="text-xs text-muted mt-0.5">
                    {s.mode === "per_episode" ? "各話ごと" : "作品単位"}・{s.status}
                  </p>
                </div>
                <button
                  onClick={() => unsubscribe(s.id)}
                  className="text-sm text-muted hover:text-accent border border-line-strong px-3 py-1.5 rounded-[var(--radius-card)] transition"
                >
                  登録解除
                </button>
              </li>
            ))}
          </ul>
        )}

        {state === "error" && <p className="text-accent text-sm">読み込みに失敗しました。</p>}
      </div>
    </div>
  );
}
