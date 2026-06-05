import Link from "next/link";

export function SiteFooter() {
  return (
    <footer className="border-t border-line mt-20">
      <div className="mx-auto max-w-6xl px-5 sm:px-8 py-10">
        <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
          <div>
            <p className="display text-lg text-ink">アニメ放送カレンダー</p>
            <p className="text-sm text-muted mt-1">
              放送中・放送予定のアニメ情報を、必要な作品だけGoogleカレンダーへ。
            </p>
            <nav className="flex flex-wrap gap-x-4 gap-y-1 mt-3 text-xs">
              <Link href="/about" className="text-ink-soft hover:text-accent">このサイトについて</Link>
              <Link href="/privacy" className="text-ink-soft hover:text-accent">プライバシーポリシー</Link>
              <Link href="/terms" className="text-ink-soft hover:text-accent">利用規約</Link>
            </nav>
          </div>
          <div className="text-xs text-muted leading-relaxed">
            <p>作品情報: Annict ／ 放送: しょぼいカレンダー</p>
            <p>評価: AniList ／ MyAnimeList</p>
            <p className="mt-1">運営: trifstudio</p>
          </div>
        </div>
      </div>
    </footer>
  );
}
