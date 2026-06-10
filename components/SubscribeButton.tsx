"use client";

import { useCallback, useState } from "react";
import Link from "next/link";
import type { SubscriptionMode } from "@/lib/types";

type Phase = "idle" | "choosing" | "need-auth" | "submitting" | "done" | "error";

/**
 * 作品を「選択リスト」へ登録するボタン。
 * 旧 AddToCalendar と違い、Googleカレンダーへ直接書き込まず、
 * 登録した作品が ICS 購読フィード（/cal/{token}.ics）に載る方式。
 */
export function SubscribeButton({
  workId,
  workTitle,
  compact = false,
}: {
  workId: string;
  workTitle: string;
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState<Phase>("idle");
  const [demo, setDemo] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState(0);

  // 選択状態
  const [mode, setMode] = useState<SubscriptionMode>("per_episode");
  const [includeSubtitle, setIncludeSubtitle] = useState(true);
  const [includeChannel, setIncludeChannel] = useState(true);
  const [includeUrl, setIncludeUrl] = useState(true);

  const startAuth = useCallback(() => {
    const returnTo = typeof window !== "undefined" ? window.location.pathname : `/works/${workId}`;
    window.location.href = `/api/auth/google/start?returnTo=${encodeURIComponent(returnTo)}`;
  }, [workId]);

  const openModal = useCallback(() => {
    setOpen(true);
    setPhase("choosing");
    setError(null);
  }, []);

  const submit = useCallback(async () => {
    setPhase("submitting");
    setError(null);
    try {
      const res = await fetch("/api/subscriptions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workId, mode, includeSubtitle, includeChannel, includeUrl }),
      });
      if (res.status === 401) {
        setPhase("need-auth");
        return;
      }
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `登録に失敗しました (${res.status})`);
      }
      const data = await res.json();
      setDemo(Boolean(data.demo));
      setCreated(data.created ?? 0);
      setPhase("done");
    } catch (e) {
      setError(e instanceof Error ? e.message : "不明なエラー");
      setPhase("error");
    }
  }, [workId, mode, includeSubtitle, includeChannel, includeUrl]);

  const close = () => {
    setOpen(false);
    setPhase("idle");
  };

  return (
    <>
      {compact ? (
        <button
          onClick={openModal}
          title="カレンダーに登録"
          aria-label="カレンダーに登録"
          className="inline-flex items-center justify-center w-8 h-8 bg-surface border border-line-strong text-ink-soft rounded-lg hover:border-accent hover:text-accent transition-colors"
        >
          <CalendarGlyph />
        </button>
      ) : (
        <button
          onClick={openModal}
          className="inline-flex items-center gap-2 bg-accent text-white px-5 py-2.5 rounded-lg text-sm font-bold hover:opacity-90 transition shadow-sm"
        >
          <CalendarGlyph />
          カレンダーに登録
        </button>
      )}

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 px-3"
          onClick={close}
        >
          <div
            className="w-full max-w-md bg-surface rounded-xl shadow-2xl max-h-[88vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-6 py-5 border-b border-line flex items-start justify-between gap-4">
              <div>
                <p className="kicker">カレンダー登録</p>
                <h2 className="font-black text-lg mt-1 leading-snug">{workTitle}</h2>
              </div>
              <button onClick={close} className="text-muted hover:text-ink text-xl leading-none mt-1">
                ×
              </button>
            </div>

            <div className="px-6 py-5">
              {phase === "need-auth" && (
                <div className="py-2">
                  <p className="text-sm text-ink-soft leading-relaxed">
                    登録した作品をどの端末からでも管理できるように、Googleでのログイン（本人確認のみ）が必要です。
                    カレンダーへのアクセス権限は求めません。閲覧だけならログインは不要です。
                  </p>
                  <button
                    onClick={startAuth}
                    className="mt-5 w-full bg-ink text-white py-2.5 rounded-lg text-sm font-bold hover:opacity-90 transition"
                  >
                    Googleでログインして続ける
                  </button>
                </div>
              )}

              {phase === "choosing" && (
                <div className="space-y-5">
                  <Field label="予定の単位">
                    <div className="flex gap-2">
                      <Choice active={mode === "per_episode"} onClick={() => setMode("per_episode")}>
                        各話ごと
                        <span className="block text-[0.68rem] text-muted mt-0.5">【アニメ】作品名 第○話</span>
                      </Choice>
                      <Choice active={mode === "whole"} onClick={() => setMode("whole")}>
                        作品単位
                        <span className="block text-[0.68rem] text-muted mt-0.5">【アニメ】作品名</span>
                      </Choice>
                    </div>
                  </Field>

                  <Field label="説明欄に含める">
                    <div className="space-y-1.5">
                      <Toggle checked={includeSubtitle} onChange={setIncludeSubtitle} label="サブタイトル" />
                      <Toggle checked={includeChannel} onChange={setIncludeChannel} label="放送局" />
                      <Toggle checked={includeUrl} onChange={setIncludeUrl} label="作品ページのURL" />
                    </div>
                  </Field>

                  <button
                    onClick={submit}
                    className="w-full bg-accent text-white py-2.5 rounded-lg text-sm font-bold hover:opacity-90 transition"
                  >
                    登録する
                  </button>
                  <p className="text-[0.72rem] text-muted leading-relaxed">
                    登録した作品の放送予定は、購読URL（マイページで取得）を通じてGoogleカレンダーへ自動反映されます。
                    新しい放送回も自動で追加され、重複することはありません。
                  </p>
                </div>
              )}

              {phase === "submitting" && <p className="text-sm text-muted py-6 text-center">登録しています…</p>}

              {phase === "done" && (
                <div className="py-4 text-center">
                  <p className="font-black text-xl text-ink">登録しました</p>
                  <p className="text-sm text-ink-soft mt-2 leading-relaxed">
                    {created} 件の放送予定がフィードに追加されます。
                    {demo ? (
                      <>
                        <br />
                        （デモモードのため実際の登録は行われていません）
                      </>
                    ) : (
                      <>
                        <br />
                        カレンダー購読が未設定の場合は、マイページの購読URLを一度だけGoogleカレンダーに設定してください。
                      </>
                    )}
                  </p>
                  <div className="mt-5 flex items-center justify-center gap-3">
                    {!demo && (
                      <Link
                        href="/me"
                        className="bg-ink text-white px-5 py-2 rounded-lg text-sm font-bold hover:opacity-90 transition"
                      >
                        購読設定を確認
                      </Link>
                    )}
                    <button
                      onClick={close}
                      className="border border-line-strong px-5 py-2 rounded-lg text-sm hover:bg-paper transition"
                    >
                      閉じる
                    </button>
                  </div>
                </div>
              )}

              {phase === "error" && (
                <div className="py-4 text-center">
                  <p className="text-sm text-accent">{error}</p>
                  <button
                    onClick={() => setPhase("choosing")}
                    className="mt-4 border border-line-strong px-5 py-2 rounded-lg text-sm hover:bg-paper transition"
                  >
                    やり直す
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="kicker mb-2">{label}</p>
      {children}
    </div>
  );
}

function Choice({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex-1 text-left px-3 py-2 rounded-lg border-2 text-sm font-medium transition ${
        active ? "border-accent bg-accent/5 text-ink" : "border-line text-ink-soft hover:border-line-strong"
      }`}
    >
      {children}
    </button>
  );
}

function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <label className="flex items-center gap-2.5 text-sm text-ink-soft cursor-pointer select-none">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="accent-[var(--color-accent)] w-4 h-4"
      />
      {label}
    </label>
  );
}

function CalendarGlyph() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden>
      <rect x="1.5" y="2.5" width="13" height="12" rx="1" stroke="currentColor" strokeWidth="1.3" />
      <path d="M1.5 6h13M5 1.5v2M11 1.5v2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  );
}
