export const revalidate = 300;

import Link from "next/link";
import type { Metadata } from "next";
import {
  getRecentAiComments,
  getAiCommentHistory,
  type AiCommentScope,
} from "@/lib/analytics/aiComments";

export const metadata: Metadata = { title: "AIコメント履歴" };

const SCOPE_LABELS: Record<string, string> = {
  season: "今期の所感",
  work: "作品の声",
  episode: "各話の声",
  news: "ニュース",
};

const SCOPE_OPTIONS: { value: string; label: string }[] = [
  { value: "", label: "すべて" },
  { value: "season", label: "今期の所感" },
  { value: "work", label: "作品の声" },
  { value: "episode", label: "各話の声" },
  { value: "news", label: "ニュース" },
];

function scopeLabel(scope: string): string {
  return SCOPE_LABELS[scope] ?? scope;
}

/** ISO 文字列を JST の "YYYY/MM/DD HH:mm" 形式に変換する（サーバーサイドのみ）。 */
function toJst(iso: string): string {
  if (!iso) return "—";
  try {
    return new Intl.DateTimeFormat("ja-JP", {
      timeZone: "Asia/Tokyo",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    })
      .format(new Date(iso))
      .replace(/\//g, "/");
  } catch {
    return iso;
  }
}

export default async function AiLogPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const scopeParam = typeof sp.scope === "string" ? sp.scope : "";

  const comments =
    scopeParam
      ? await getAiCommentHistory(scopeParam as AiCommentScope, undefined, 80).catch(() => [])
      : await getRecentAiComments(80).catch(() => []);

  return (
    <div className="mx-auto max-w-4xl px-4 sm:px-6">
      {/* パンくず */}
      <div className="pt-4 text-xs text-muted">
        <Link href="/analytics" className="hover:text-primary">
          アニメ分析
        </Link>
        <span className="mx-1.5">›</span>
        <span className="text-ink-soft">AIコメント履歴</span>
      </div>

      {/* ヘッダー */}
      <header className="card mt-3 p-5 sm:p-6">
        <p className="text-xs font-bold text-accent">AI コメント</p>
        <h1 className="text-xl sm:text-2xl font-black leading-snug mt-1">AIコメント履歴</h1>
        <p className="text-xs text-muted mt-2 leading-relaxed">
          Grok（X 検索）が生成した「今期の所感」「作品の声」などを時系列で蓄積したログです。
          生成のたびに追記されるため、過去のコメントを生成時刻つきで遡れます。
        </p>
      </header>

      {/* scope 絞り込みリンク */}
      <nav className="mt-4 flex flex-wrap gap-2">
        {SCOPE_OPTIONS.map((opt) => {
          const active = opt.value === scopeParam;
          const href = opt.value ? `/analytics/ai-log?scope=${opt.value}` : "/analytics/ai-log";
          return (
            <Link
              key={opt.value}
              href={href}
              className={[
                "px-3 py-1 rounded-full text-xs font-bold border transition",
                active
                  ? "bg-accent text-white border-accent"
                  : "border-line text-muted hover:text-primary hover:border-primary",
              ].join(" ")}
            >
              {opt.label}
            </Link>
          );
        })}
      </nav>

      {/* コメント一覧 */}
      <div className="space-y-3 py-5">
        {comments.length === 0 ? (
          <div className="card p-8 text-center text-sm text-muted">
            まだ履歴がありません（migration 0015 適用後に蓄積されます）
          </div>
        ) : (
          comments.map((c) => (
            <article key={c.id} className="card p-4 sm:p-5">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mb-2">
                {/* scope バッジ */}
                <span className="text-[0.68rem] font-black text-accent bg-accent/10 px-2 py-0.5 rounded-full">
                  {scopeLabel(c.scope)}
                </span>
                {/* タイトル */}
                {c.title && (
                  <span className="text-sm font-bold text-ink leading-tight">{c.title}</span>
                )}
                {/* 生成時刻 (JST) */}
                <time
                  dateTime={c.generatedAt}
                  className="ml-auto text-[0.7rem] text-muted tabular-nums shrink-0"
                >
                  {toJst(c.generatedAt)}
                </time>
              </div>
              <p className="text-[0.88rem] leading-[1.85] text-ink-soft whitespace-pre-wrap">
                {c.body}
              </p>
            </article>
          ))
        )}
      </div>

      <p className="pb-6 text-xs text-muted leading-relaxed">
        ※ コメントは Grok（xAI）および X(Twitter) の分析結果です。各サービス利用者を母数とした参考値です。
      </p>
    </div>
  );
}
