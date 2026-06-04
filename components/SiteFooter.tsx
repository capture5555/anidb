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
          </div>
          <div className="text-xs text-muted leading-relaxed">
            <p>
              作品情報: Annict ／ 放送スケジュール: しょぼいカレンダー
            </p>
            <p className="mt-1">社内・身内向け試験運用版</p>
          </div>
        </div>
      </div>
    </footer>
  );
}
