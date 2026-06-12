import Link from "next/link";
import type { MovieSort } from "@/lib/types";

const SORTS: { key: MovieSort; label: string }[] = [
  { key: "popular", label: "人気順" },
  { key: "newest", label: "新着順" },
  { key: "upcoming", label: "公開予定が近い順" },
  { key: "kana", label: "タイトル順" },
];

/**
 * 映画タブの並び替えセレクタ（サーバー描画・JS不要のリンク）。
 */
export function MovieSort({ active, q, genre }: { active: MovieSort; q?: string; genre?: string }) {
  const hrefFor = (sort: MovieSort) => {
    const sp = new URLSearchParams();
    sp.set("tab", "movie");
    if (sort !== "popular") sp.set("sort", sort);
    if (q) sp.set("q", q);
    if (genre) sp.set("genre", genre);
    return `/?${sp.toString()}`;
  };

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="text-xs text-muted font-bold mr-1">並び替え</span>
      {SORTS.map((s) => {
        const isActive = s.key === active;
        return (
          <Link
            key={s.key}
            href={hrefFor(s.key)}
            className={`text-xs font-medium px-3 py-1 rounded-full transition ${
              isActive
                ? "bg-ink text-white"
                : "bg-surface border border-line text-ink-soft hover:border-line-strong"
            }`}
          >
            {s.label}
          </Link>
        );
      })}
    </div>
  );
}
