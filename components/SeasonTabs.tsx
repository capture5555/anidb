import Link from "next/link";
import type { ListTab } from "@/lib/types";

const TABS: { key: ListTab; label: string }[] = [
  { key: "this_season", label: "今期" },
  { key: "next_season", label: "来期" },
  { key: "movie", label: "映画" },
];

export function SeasonTabs({ active }: { active: ListTab }) {
  return (
    <nav className="border-b-2 border-line">
      <ul className="flex gap-1 -mb-[2px]">
        {TABS.map((t) => {
          const isActive = t.key === active;
          return (
            <li key={t.key}>
              <Link
                href={t.key === "this_season" ? "/" : `/?tab=${t.key}`}
                className={`inline-block px-5 sm:px-7 py-2.5 font-bold text-[0.95rem] border-b-[3px] transition-colors ${
                  isActive
                    ? "border-accent text-ink"
                    : "border-transparent text-muted hover:text-ink-soft"
                }`}
              >
                {t.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
