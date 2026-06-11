import Link from "next/link";

const NAV = [
  { href: "/", label: "作品一覧" },
  { href: "/schedule", label: "番組表" },
  { href: "/analytics", label: "分析" },
  { href: `/analytics/studios/${encodeURIComponent("TriF")}`, label: "TriF分析" },
  { href: "/me", label: "マイ登録" },
];

export function SiteHeader() {
  return (
    <header className="bg-brand text-white sticky top-0 z-30 shadow-[0_1px_0_rgba(255,255,255,0.08),0_2px_12px_rgba(10,14,26,0.35)]">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <div className="flex items-center justify-between gap-4 h-14">
          <Link href="/" className="flex items-center gap-2.5 shrink-0">
            {/* ロゴマーク: 再生ボタン風 */}
            <span className="grid place-items-center w-7 h-7 rounded-md bg-accent">
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
                <path d="M3 1.5L10 6L3 10.5V1.5Z" fill="white" />
              </svg>
            </span>
            <span className="font-black text-[1.05rem] sm:text-lg tracking-tight leading-none">
              アニメ放送カレンダー
            </span>
          </Link>
          <nav className="flex items-center gap-0.5 sm:gap-1 text-sm overflow-x-auto">
            {NAV.map((n) => (
              <Link
                key={n.href}
                href={n.href}
                className="shrink-0 px-2.5 sm:px-3.5 py-2 rounded-md text-white/80 hover:text-white hover:bg-white/10 transition font-medium"
              >
                {n.label}
              </Link>
            ))}
          </nav>
        </div>
      </div>
    </header>
  );
}
