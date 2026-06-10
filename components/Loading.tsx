/**
 * 画面遷移時のローディング表示。
 * App Router の loading.tsx から使い、サーバー側のデータ取得が終わるまで即座に表示される。
 */

export function Spinner({ className = "" }: { className?: string }) {
  return (
    <span
      className={`inline-block animate-spin rounded-full border-2 border-line-strong border-t-accent ${className}`}
      role="status"
      aria-label="読み込み中"
    />
  );
}

/** ページ全体のローディング（中央スピナー＋メッセージ） */
export function PageLoading({ message = "読み込んでいます…" }: { message?: string }) {
  return (
    <div className="mx-auto max-w-6xl px-4 sm:px-6">
      <div className="flex flex-col items-center justify-center gap-3 py-24 text-muted">
        <Spinner className="w-8 h-8" />
        <p className="text-sm font-medium">{message}</p>
      </div>
    </div>
  );
}

/** カード型のスケルトン（任意の高さ） */
export function CardSkeleton({ height = "h-64" }: { height?: string }) {
  return <div className={`card ${height} animate-pulse bg-paper/60`} />;
}
