"use client";

import { useState, useCallback } from "react";
import type { GoogleCalendarInfo, SubscriptionMode } from "@/lib/types";

type Phase = "idle" | "loading" | "need-auth" | "choosing" | "submitting" | "done" | "error";

export function AddToCalendar({
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
  const [calendars, setCalendars] = useState<GoogleCalendarInfo[]>([]);
  const [demo, setDemo] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ created: number; updated: number } | null>(null);

  // 選択状態
  const [calendarId, setCalendarId] = useState<string>("");
  const [mode, setMode] = useState<SubscriptionMode>("per_episode");
  const [includeSubtitle, setIncludeSubtitle] = useState(true);
  const [includeChannel, setIncludeChannel] = useState(true);
  const [includeUrl, setIncludeUrl] = useState(true);

  const startAuth = useCallback(() => {
    const returnTo = `/works/${workId}?add=1`;
    window.location.href = `/api/auth/google/start?returnTo=${encodeURIComponent(returnTo)}`;
  }, [workId]);

  const loadCalendars = useCallback(async () => {
    setPhase("loading");
    setError(null);
    try {
      const res = await fetch("/api/me/calendars");
      if (res.status === 401) {
        setPhase("need-auth");
        return;
      }
      if (!res.ok) throw new Error(`カレンダー取得に失敗しました (${res.status})`);
      const data = await res.json();
      const writable: GoogleCalendarInfo[] = (data.calendars ?? []).filter(
        (c: GoogleCalendarInfo) => c.accessRole === "owner" || c.accessRole === "writer",
      );
      setCalendars(writable);
      setDemo(Boolean(data.demo));
      setCalendarId(writable.find((c) => c.primary)?.id ?? writable[0]?.id ?? "");
      setPhase("choosing");
    } catch (e) {
      setError(e instanceof Error ? e.message : "不明なエラー");
      setPhase("error");
    }
  }, []);

  const openModal = useCallback(() => {
    setOpen(true);
    setResult(null);
    void loadCalendars();
  }, [loadCalendars]);

  const submit = useCallback(async () => {
    setPhase("submitting");
    setError(null);
    try {
      const res = await fetch("/api/subscriptions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workId,
          googleCalendarId: calendarId,
          mode,
          includeSubtitle,
          includeChannel,
          includeUrl,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `登録に失敗しました (${res.status})`);
      }
      const data = await res.json();
      setResult({ created: data.created ?? 0, updated: data.updated ?? 0 });
      setPhase("done");
    } catch (e) {
      setError(e instanceof Error ? e.message : "不明なエラー");
      setPhase("error");
    }
  }, [workId, calendarId, mode, includeSubtitle, includeChannel, includeUrl]);

  const close = () => {
    setOpen(false);
    setPhase("idle");
  };

  return (
    <>
      {compact ? (
        <button
          onClick={openModal}
          title="Googleカレンダーへ追加"
          aria-label="Googleカレンダーへ追加"
          className="inline-flex items-center justify-center w-8 h-8 border border-line-strong text-ink-soft rounded-[var(--radius-card)] hover:border-accent hover:text-accent transition-colors"
        >
          <CalendarGlyph />
        </button>
      ) : (
        <button
          onClick={openModal}
          className="inline-flex items-center gap-2 bg-accent text-paper px-5 py-2.5 rounded-[var(--radius-card)] text-sm font-medium tracking-wide hover:bg-[var(--color-accent-soft)] transition-colors"
        >
          <CalendarGlyph />
          Googleカレンダーへ追加
        </button>
      )}

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-ink/30 px-3"
          onClick={close}
        >
          <div
            className="w-full max-w-md bg-surface border border-line-strong rounded-[var(--radius-card)] shadow-[0_8px_40px_-12px_rgba(33,29,24,0.35)] max-h-[88vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-6 py-5 border-b border-line flex items-start justify-between gap-4">
              <div>
                <p className="kicker">カレンダー登録</p>
                <h2 className="display text-lg mt-1 leading-snug">{workTitle}</h2>
              </div>
              <button onClick={close} className="text-muted hover:text-ink text-xl leading-none mt-1">
                ×
              </button>
            </div>

            <div className="px-6 py-5">
              {phase === "loading" && <p className="text-sm text-muted py-6 text-center">カレンダーを読み込み中…</p>}

              {phase === "need-auth" && (
                <div className="py-2">
                  <p className="text-sm text-ink-soft leading-relaxed">
                    カレンダーへ登録するには、Googleでのログイン（カレンダーへのアクセス許可）が必要です。閲覧だけならログインは不要です。
                  </p>
                  <button
                    onClick={startAuth}
                    className="mt-5 w-full bg-ink text-paper py-2.5 rounded-[var(--radius-card)] text-sm font-medium hover:opacity-90 transition"
                  >
                    Googleでログインして続ける
                  </button>
                </div>
              )}

              {phase === "choosing" && (
                <div className="space-y-5">
                  {demo && (
                    <p className="text-xs text-[var(--color-info)] bg-[var(--color-info)]/8 border border-[var(--color-info)]/25 rounded-[var(--radius-card)] px-3 py-2 leading-relaxed">
                      デモモードで表示しています（Google連携が未設定）。実際の登録は行われませんが、操作の流れを確認できます。
                    </p>
                  )}

                  <Field label="登録先カレンダー">
                    <select
                      value={calendarId}
                      onChange={(e) => setCalendarId(e.target.value)}
                      className="w-full border border-line-strong bg-paper rounded-[var(--radius-card)] px-3 py-2 text-sm"
                    >
                      {calendars.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.summary}
                          {c.primary ? "（メイン）" : ""}
                        </option>
                      ))}
                    </select>
                  </Field>

                  <Field label="登録の単位">
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
                    disabled={!calendarId}
                    className="w-full bg-accent text-paper py-2.5 rounded-[var(--radius-card)] text-sm font-medium hover:bg-[var(--color-accent-soft)] transition disabled:opacity-40"
                  >
                    このカレンダーに登録する
                  </button>
                  <p className="text-[0.72rem] text-muted leading-relaxed">
                    登録後は、PCを起動していなくても新しい放送回が自動で追加されます。同じ予定が重複して登録されることはありません。
                  </p>
                </div>
              )}

              {phase === "submitting" && <p className="text-sm text-muted py-6 text-center">登録しています…</p>}

              {phase === "done" && result && (
                <div className="py-4 text-center">
                  <p className="display text-xl text-ink">登録しました</p>
                  <p className="text-sm text-ink-soft mt-2 leading-relaxed">
                    {result.created} 件の放送予定を追加しました
                    {result.updated > 0 && `（${result.updated} 件を更新）`}。<br />
                    今後の放送回も自動で追加されます。
                  </p>
                  <button
                    onClick={close}
                    className="mt-5 border border-line-strong px-5 py-2 rounded-[var(--radius-card)] text-sm hover:bg-paper-deep transition"
                  >
                    閉じる
                  </button>
                </div>
              )}

              {phase === "error" && (
                <div className="py-4 text-center">
                  <p className="text-sm text-accent">{error}</p>
                  <button
                    onClick={() => void loadCalendars()}
                    className="mt-4 border border-line-strong px-5 py-2 rounded-[var(--radius-card)] text-sm hover:bg-paper-deep transition"
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
      className={`flex-1 text-left px-3 py-2 rounded-[var(--radius-card)] border text-sm transition ${
        active ? "border-accent bg-accent/6 text-ink" : "border-line-strong text-ink-soft hover:border-line"
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
