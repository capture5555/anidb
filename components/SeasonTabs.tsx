import Link from "next/link";
import type { ListTab } from "@/lib/types";

const TABS: { key: ListTab; label: string; sub: string }[] = [
  { key: "this_season", label: "今シーズン", sub: "This season" },
  { key: "next_season", label: "来シーズン", sub: "Next season" },
  { key: "airing", label: "放送中", sub: "On air" },
  { key: "upcoming", label: "放送予定", sub: "Upcoming" },
];

export function SeasonTabs({ active }: { active: ListTab }) {
  return (
    <nav className="border-b border-line">
      <ul className="flex flex-wrap gap-x-7 gap-y-2 -mb-px">
        {TABS.map((t) => {
          const isActive = t.key === active;
          return (
            <li key={t.key}>
              <Link
                href={t.key === "this_season" ? "/" : `/?tab=${t.key}`}
                className={`group inline-flex flex-col pb-3 border-b-2 transition-colors ${
                  isActive
                    ? "border-accent text-ink"
                    : "border-transparent text-ink-soft hover:text-ink"
                }`}
              >
                <span className="display text-base sm:text-lg">{t.label}</span>
                <span
                  className={`text-[0.62rem] tracking-[0.2em] uppercase ${
                    isActive ? "text-accent" : "text-muted"
                  }`}
                >
                  {t.sub}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
