import Link from "next/link";

export function SiteFooter() {
  return (
    <footer className="bg-brand text-white mt-16">
      <div className="mx-auto max-w-6xl px-4 sm:px-6 py-10">
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-6">
          <div>
            <p className="font-black text-lg">アニメ作品データベース</p>
            <p className="text-sm text-white/60 mt-1.5">
              放送中・放送予定のアニメ情報と分析。気になる作品はGoogleカレンダーへ。
            </p>
            <nav className="flex flex-wrap gap-x-5 gap-y-1.5 mt-4 text-xs">
              <Link href="/about" className="text-white/70 hover:text-white transition">このサイトについて</Link>
              <Link href="/privacy" className="text-white/70 hover:text-white transition">プライバシーポリシー</Link>
              <Link href="/terms" className="text-white/70 hover:text-white transition">利用規約</Link>
            </nav>
          </div>
          <div className="text-xs text-white/50 leading-relaxed sm:text-right">
            <p>作品情報: Annict ／ 評価: AniList・MyAnimeList</p>
            <p>実況データ: ニコニコ実況 過去ログAPI</p>
          </div>
        </div>
      </div>
    </footer>
  );
}
