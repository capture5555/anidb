"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

interface SubRow {
  id: string;
  work_id: string;
  mode: string;
  status: string;
  works?: { title: string };
  /** この購読固有の放送局選択（pre-migration では undefined/null）。 */
  channels?: string[] | null;
  /** この作品が放送される放送局の選択肢（GET API が付与・おすすめ順）。 */
  channelOptions?: string[];
}

export default function MyPage() {
  const [state, setState] = useState<"loading" | "demo" | "need-auth" | "ready" | "error">("loading");
  const [subs, setSubs] = useState<SubRow[]>([]);
  const [feedUrl, setFeedUrl] = useState<string | null>(null);
  const [feedDemo, setFeedDemo] = useState(false);
  const [target, setTarget] = useState<SubRow | null>(null); // 解除確認中の対象
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [regenConfirm, setRegenConfirm] = useState(false);
  const [editingChannels, setEditingChannels] = useState<string | null>(null); // 放送局を編集中の購読ID
  const [savingChannels, setSavingChannels] = useState(false);

  const load = async () => {
    try {
      const res = await fetch("/api/subscriptions");
      if (res.status === 401) return setState("need-auth");
      if (!res.ok) return setState("error");
      const data = await res.json();
      if (data.demo) {
        setState("demo");
      } else {
        setSubs(data.subscriptions ?? []);
        setState("ready");
      }
      // 購読URL（デモでもサンプルURLを返す）
      const feedRes = await fetch("/api/me/feed");
      if (feedRes.ok) {
        const feed = await feedRes.json();
        setFeedUrl(feed.url ?? null);
        setFeedDemo(Boolean(feed.demo));
      }
    } catch {
      setState("error");
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const copyUrl = async () => {
    if (!feedUrl) return;
    try {
      await navigator.clipboard.writeText(feedUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setToast("コピーに失敗しました。URLを選択してコピーしてください。");
      setTimeout(() => setToast(null), 5000);
    }
  };

  const regenerate = async () => {
    setBusy(true);
    try {
      const res = await fetch("/api/me/feed", { method: "POST" });
      if (!res.ok) throw new Error();
      const data = await res.json();
      setFeedUrl(data.url ?? null);
      setRegenConfirm(false);
      setToast("購読URLを再発行しました。Googleカレンダー側も新しいURLで登録し直してください。");
      setTimeout(() => setToast(null), 7000);
    } catch {
      setToast("再生成に失敗しました。もう一度お試しください。");
      setTimeout(() => setToast(null), 5000);
    } finally {
      setBusy(false);
    }
  };

  const doUnsubscribe = async () => {
    if (!target) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/subscriptions/${target.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error();
      const title = target.works?.title ?? "作品";
      setTarget(null);
      await load(); // 一覧を取り直して、本当に消えたか確認
      setToast(`「${title}」の登録を解除しました。カレンダーの予定も最大24時間程度で自動的に消えます。`);
      setTimeout(() => setToast(null), 7000);
    } catch {
      setToast("解除に失敗しました。もう一度お試しください。");
      setTimeout(() => setToast(null), 5000);
    } finally {
      setBusy(false);
    }
  };

  // 放送局選択を保存する（PATCH /api/subscriptions/[id]）。
  const saveChannels = async (sub: SubRow, next: string[]) => {
    setSavingChannels(true);
    // 楽観更新（編集中の表示を即反映）
    setSubs((prev) => prev.map((s) => (s.id === sub.id ? { ...s, channels: next } : s)));
    try {
      const res = await fetch(`/api/subscriptions/${sub.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channels: next }),
      });
      if (!res.ok) throw new Error();
      setToast("放送局の設定を保存しました。カレンダーには次回取得時に反映されます。");
      setTimeout(() => setToast(null), 5000);
    } catch {
      setToast("放送局の保存に失敗しました。もう一度お試しください。");
      setTimeout(() => setToast(null), 5000);
      await load(); // サーバ状態に戻す
    } finally {
      setSavingChannels(false);
    }
  };

  return (
    <div className="mx-auto max-w-3xl px-5 sm:px-8 py-12">
      <p className="kicker">My list</p>
      <h1 className="display text-3xl mt-3">登録した作品</h1>

      {/* カレンダー購読URL */}
      {feedUrl && (state === "ready" || state === "demo") && (
        <div className="mt-8 border border-line rounded-lg bg-surface p-6">
          <p className="kicker">カレンダー購読URL</p>
          {feedDemo && (
            <p className="mt-2 text-xs text-[var(--color-info)] leading-relaxed">
              デモモードのサンプルURLです。Google連携を設定すると、あなた専用のURLが発行されます。
            </p>
          )}
          <p className="text-sm text-ink-soft mt-3 leading-relaxed">
            このURLを一度だけGoogleカレンダーに設定すると、登録した作品の放送予定が自動で反映され続けます。
            作品を解除すれば予定も自動で消えます（反映はGoogle側の取得タイミング次第で最大24時間程度）。
          </p>
          <div className="mt-4 flex items-center gap-2">
            <input
              readOnly
              value={feedUrl}
              onFocus={(e) => e.currentTarget.select()}
              className="flex-1 min-w-0 border border-line-strong bg-paper rounded-lg px-3 py-2 text-xs text-ink-soft font-mono"
            />
            <button
              onClick={copyUrl}
              className="shrink-0 bg-ink text-white px-4 py-2 rounded-lg text-sm hover:opacity-90 transition"
            >
              {copied ? "コピーしました" : "コピー"}
            </button>
            {!feedDemo && (
              <button
                onClick={() => setRegenConfirm(true)}
                disabled={busy}
                className="shrink-0 border border-line-strong text-ink-soft px-4 py-2 rounded-lg text-sm hover:border-accent hover:text-accent transition disabled:opacity-40"
              >
                URLを再発行
              </button>
            )}
          </div>
          <details className="mt-4">
            <summary className="text-sm text-ink-soft cursor-pointer select-none hover:text-ink">
              初回の設定手順（Googleカレンダー）
            </summary>
            <ol className="list-decimal pl-5 mt-3 space-y-1.5 text-sm text-ink-soft leading-relaxed">
              <li>上のURLをコピーする</li>
              <li>
                PCブラウザでGoogleカレンダーを開き、左下の「他のカレンダー」横の「＋」→
                <strong>「URLで追加」</strong>を選ぶ
              </li>
              <li>URLを貼り付けて「カレンダーを追加」を押す</li>
              <li>「アニメ放送カレンダー」が一覧に追加されれば完了（スマホにも自動で同期されます）</li>
            </ol>
          </details>
          {!feedDemo && regenConfirm && (
            <div className="mt-4 pt-4 border-t border-line text-sm">
              <p className="text-ink-soft leading-relaxed">
                URLを再発行すると、いまGoogleカレンダーに設定済みのURLは無効になり、新しいURLでの再設定が必要です。よろしいですか？
              </p>
              <div className="mt-3 flex gap-2">
                <button
                  onClick={() => void regenerate()}
                  disabled={busy}
                  className="bg-accent text-white px-4 py-1.5 rounded-lg text-sm hover:opacity-90 transition disabled:opacity-40"
                >
                  再発行する
                </button>
                <button
                  onClick={() => setRegenConfirm(false)}
                  disabled={busy}
                  className="border border-line-strong px-4 py-1.5 rounded-lg text-sm hover:bg-paper transition disabled:opacity-40"
                >
                  やめる
                </button>
              </div>
            </div>
          )}
          {!feedDemo && !regenConfirm && (
            <p className="mt-2 text-[0.72rem] text-muted">
              URLが他人に知られた場合は「URLを再発行」で作り直せます（旧URLは無効になります）。
            </p>
          )}
        </div>
      )}

      <div className="mt-8">
        {state === "loading" && <p className="text-muted text-sm">読み込み中…</p>}

        {state === "need-auth" && (
          <div className="border border-line rounded-lg p-6 bg-surface">
            <p className="text-ink-soft text-sm leading-relaxed">
              登録した作品を表示するには、Googleでのログイン（本人確認のみ・カレンダー権限は不要）が必要です。
            </p>
            <a
              href="/api/auth/google/start?returnTo=/me"
              className="inline-block mt-4 bg-ink text-white px-5 py-2.5 rounded-lg text-sm hover:opacity-90 transition"
            >
              Googleでログイン
            </a>
          </div>
        )}

        {state === "demo" && (
          <div className="border border-[var(--color-info)]/30 bg-[var(--color-info)]/8 rounded-lg p-6">
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
              作品ページの「カレンダーに登録」から登録できます。
            </p>
            <Link
              href="/"
              className="inline-block mt-6 border border-line-strong px-5 py-2 rounded-lg text-sm hover:bg-paper transition"
            >
              作品を探す
            </Link>
          </div>
        )}

        {state === "ready" && subs.length > 0 && (
          <ul className="divide-y divide-line border-y border-line">
            {subs.map((s) => {
              const options = s.channelOptions ?? [];
              const selected = s.channels ?? null;
              const editing = editingChannels === s.id;
              const canEdit = options.length > 1; // 1局以下なら選ぶ余地が無い
              return (
                <li key={s.id} className="py-4">
                  <div className="flex items-center justify-between gap-4">
                    <div className="min-w-0">
                      <Link
                        href={`/works/${s.work_id}`}
                        className="display text-lg hover:text-accent transition"
                      >
                        {s.works?.title ?? "(作品)"}
                      </Link>
                      <p className="text-xs text-muted mt-0.5">
                        {s.mode === "per_episode" ? "各話ごと" : "作品単位"}
                        {options.length > 0 && (
                          <>
                            <span className="mx-1.5">·</span>
                            <span>
                              放送局:{" "}
                              {selected && selected.length > 0 ? selected.join("、") : "すべて"}
                            </span>
                          </>
                        )}
                      </p>
                    </div>
                    <div className="shrink-0 flex items-center gap-2">
                      {canEdit && (
                        <button
                          onClick={() => setEditingChannels(editing ? null : s.id)}
                          className="text-sm text-muted hover:text-accent border border-line-strong px-3 py-1.5 rounded-lg transition"
                        >
                          {editing ? "閉じる" : "放送局"}
                        </button>
                      )}
                      <button
                        onClick={() => setTarget(s)}
                        className="text-sm text-muted hover:text-accent border border-line-strong px-3 py-1.5 rounded-lg transition"
                      >
                        登録解除
                      </button>
                    </div>
                  </div>

                  {canEdit && editing && (
                    <div className="mt-3 rounded-lg border border-line bg-paper p-3">
                      <p className="kicker mb-2">カレンダーに入れる放送局</p>
                      <div className="flex flex-wrap gap-1.5">
                        {options.map((name) => {
                          // 未設定(null/空)は「すべて」とみなし、全局を選択中として描画する。
                          const active =
                            selected && selected.length > 0 ? selected.includes(name) : true;
                          return (
                            <button
                              key={name}
                              type="button"
                              disabled={savingChannels}
                              aria-pressed={active}
                              onClick={() => {
                                const base =
                                  selected && selected.length > 0 ? selected : options;
                                const next = active
                                  ? base.filter((c) => c !== name)
                                  : [...base, name];
                                void saveChannels(s, next);
                              }}
                              className={`px-2.5 py-1 rounded-full border text-xs font-medium transition disabled:opacity-50 ${
                                active
                                  ? "border-accent bg-accent/10 text-ink"
                                  : "border-line text-muted hover:border-line-strong"
                              }`}
                            >
                              {name}
                            </button>
                          );
                        })}
                      </div>
                      <p className="text-[0.68rem] text-muted mt-2 leading-relaxed">
                        チェックした局の放送だけをカレンダーに入れます。すべて外すと全局が対象になります。
                      </p>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        {state === "error" && <p className="text-accent text-sm">読み込みに失敗しました。</p>}
      </div>

      {/* 解除確認ダイアログ */}
      {target && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-ink/30 px-3"
          onClick={() => !busy && setTarget(null)}
        >
          <div
            className="w-full max-w-sm bg-surface border border-line-strong rounded-lg p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="kicker">登録の解除</p>
            <h2 className="display text-lg mt-1 leading-snug">{target.works?.title}</h2>
            <p className="text-sm text-ink-soft mt-3 leading-relaxed">
              この作品の登録を解除します。購読フィードから外れるため、Googleカレンダーに表示中の予定も
              <strong>最大24時間程度で自動的に消えます</strong>（手動での削除は不要です）。
            </p>

            <div className="mt-5 space-y-2">
              <button
                onClick={() => void doUnsubscribe()}
                disabled={busy}
                className="w-full bg-accent text-white py-2.5 rounded-lg text-sm font-medium hover:opacity-90 transition disabled:opacity-40"
              >
                登録を解除する
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
        <div className="fixed bottom-5 left-1/2 -translate-x-1/2 z-50 bg-ink text-white text-sm px-4 py-2.5 rounded-lg shadow-lg max-w-[90vw] text-center">
          {toast}
        </div>
      )}
    </div>
  );
}
