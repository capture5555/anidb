import Link from "next/link";
import type { ListTab } from "@/lib/types";

/**
 * 検索フォーム + ジャンル絞り込み（サーバー描画・JS不要のGETフォーム）。
 */
export function FilterBar({
  tab,
  q,
  genre,
  genres,
}: {
  tab: ListTab;
  q?: string;
  genre?: string;
  genres: string[];
}) {
  const hrefWith = (params: Record<string, string | undefined>) => {
    const sp = new URLSearchParams();
    if (tab !== "this_season") sp.set("tab", tab);
    if (params.q ?? q) sp.set("q", (params.q ?? q)!);
    const g = "genre" in params ? params.genre : genre;
    if (g) sp.set("genre", g);
    const s = sp.toString();
    return s ? `/?${s}` : "/";
  };

  return (
    <div className="space-y-4">
      <form method="get" action="/" className="flex items-center gap-2 max-w-md">
        {tab !== "this_season" && <input type="hidden" name="tab" value={tab} />}
        {genre && <input type="hidden" name="genre" value={genre} />}
        <input
          type="search"
          name="q"
          defaultValue={q ?? ""}
          placeholder="作品名で検索"
          className="flex-1 border border-line-strong bg-surface rounded-[var(--radius-card)] px-3.5 py-2 text-sm focus:outline-none focus:border-accent"
        />
        <button
          type="submit"
          className="border border-line-strong px-4 py-2 rounded-[var(--radius-card)] text-sm hover:bg-paper-deep transition"
        >
          検索
        </button>
      </form>

      {genres.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="kicker mr-1">ジャンル</span>
          <Link
            href={hrefWith({ genre: undefined })}
            className={`text-xs px-3 py-1 rounded-full border transition ${
              !genre ? "border-accent text-accent bg-accent/6" : "border-line-strong text-ink-soft hover:border-line"
            }`}
          >
            すべて
          </Link>
          {genres.map((g) => (
            <Link
              key={g}
              href={hrefWith({ genre: g })}
              className={`text-xs px-3 py-1 rounded-full border transition ${
                genre === g
                  ? "border-accent text-accent bg-accent/6"
                  : "border-line-strong text-ink-soft hover:border-line"
              }`}
            >
              {g}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
