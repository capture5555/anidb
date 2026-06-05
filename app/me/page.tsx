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
  const [target, setTarget] = useState<SubRow | null>(null); // 解除確認中の対象
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const load = async () => {
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

  // removeEvents: true=カレンダーからも削除 / false=登録だけ解除
  const doUnsubscribe = async (removeEvents: boolean) => {
    if (!target) return;
    setBusy(true);
    try {
      const res = await fetch(
        `/api/subscriptions/${target.id}?removeEvents=${removeEvents ? "1" : "0"}`,
        { method: "DELETE" },
      );
      const data = await res.json().catch(() => ({}));
      const title = target.works?.title ?? "作品";
      setTarget(null);
      await load(); // 一覧を取り直して、本当に消えたか確認
      setToast(
        removeEvents
          ? `「${title}」を解除し、カレンダーから${data.removedEvents ?? 0}件の予定を削除しました`
          : `「${title}」の登録を解除しました（カレンダーの予定は残しました）`,
      );
      setTimeout(() => setToast(null), 5000);
    } catch {
      setToast("解除に失敗しました。もう一度お試しください。");
      setTimeout(() => setToast(null), 5000);
    } finally {
      setBusy(false);
    }
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
                <div className="min-w-0">
                  <Link href={`/works/${s.work_id}`} className="display text-lg hover:text-accent transition">
                    {s.works?.title ?? "(作品)"}
                  </Link>
                  <p className="text-xs text-muted mt-0.5">
                    {s.mode === "per_episode" ? "各話ごと" : "作品単位"}
                  </p>
                </div>
                <button
                  onClick={() => setTarget(s)}
                  className="shrink-0 text-sm text-muted hover:text-accent border border-line-strong px-3 py-1.5 rounded-[var(--radius-card)] transition"
                >
                  登録解除
                </button>
              </li>
            ))}
          </ul>
        )}

        {state === "error" && <p className="text-accent text-sm">読み込みに失敗しました。</p>}
      </div>

      {/* 解除確認ダイアログ：カレンダーからも削除するか聞く */}
      {target && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-ink/30 px-3"
          onClick={() => !busy && setTarget(null)}
        >
          <div
            className="w-full max-w-sm bg-surface border border-line-strong rounded-[var(--radius-card)] p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="kicker">登録の解除</p>
            <h2 className="display text-lg mt-1 leading-snug">{target.works?.title}</h2>
            <p className="text-sm text-ink-soft mt-3 leading-relaxed">
              この作品の追跡を解除します。すでにGoogleカレンダーへ登録済みの予定をどうしますか？
            </p>

            <div className="mt-5 space-y-2">
              <button
                onClick={() => void doUnsubscribe(true)}
                disabled={busy}
                className="w-full bg-accent text-paper py-2.5 rounded-[var(--radius-card)] text-sm font-medium hover:bg-[var(--color-accent-soft)] transition disabled:opacity-40"
              >
                カレンダーの予定も削除する
              </button>
              <button
                onClick={() => void doUnsubscribe(false)}
                disabled={busy}
                className="w-full border border-line-strong py-2.5 rounded-[var(--radius-card)] text-sm hover:bg-paper-deep transition disabled:opacity-40"
              >
                登録だけ解除（予定はカレンダーに残す）
              </button>
              <button
                onClick={() => setTarget(null)}
                disabled={busy}
                className="w-full text-muted py-2 text-sm hover:text-ink transition disabled:opacity-40"
              >
                やめる
              </button>
            </div>
            {busy && <p className="text-xs text-muted text-center mt-3">処理中…</p>}
          </div>
        </div>
      )}

      {toast && (
        <div className="fixed bottom-5 left-1/2 -translate-x-1/2 z-50 bg-ink text-paper text-sm px-4 py-2.5 rounded-[var(--radius-card)] shadow-lg max-w-[90vw] text-center">
          {toast}
        </div>
      )}
    </div>
  );
}
