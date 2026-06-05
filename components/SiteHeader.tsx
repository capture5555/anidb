import Link from "next/link";

export function SiteHeader() {
  return (
    <header className="border-b border-line bg-paper/95 backdrop-blur-[2px] sticky top-0 z-30">
      <div className="mx-auto max-w-6xl px-5 sm:px-8">
        <div className="flex items-baseline justify-between py-4">
          <Link href="/" className="group flex items-baseline gap-3">
            <span className="display text-xl sm:text-2xl text-ink tracking-tight">
              アニメ放送カレンダー
            </span>
            <span className="kicker hidden sm:inline">Anime Broadcast Calendar</span>
          </Link>
          <nav className="flex items-center gap-5 text-sm text-ink-soft">
            <Link href="/" className="hover:text-accent transition-colors">
              一覧
            </Link>
            <Link href="/schedule" className="hover:text-accent transition-colors">
              番組表
            </Link>
            <Link href="/me" className="hover:text-accent transition-colors">
              マイ登録
            </Link>
            <Link href="/about" className="hover:text-accent transition-colors hidden sm:inline">
              このサイトについて
            </Link>
          </nav>
        </div>
      </div>
    </header>
  );
}
