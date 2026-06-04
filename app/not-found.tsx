import Link from "next/link";

export default function NotFound() {
  return (
    <div className="mx-auto max-w-2xl px-5 py-28 text-center">
      <p className="kicker">404</p>
      <h1 className="display text-3xl mt-3">ページが見つかりません</h1>
      <p className="text-ink-soft mt-3">
        お探しの作品やページは存在しないか、移動した可能性があります。
      </p>
      <Link
        href="/"
        className="inline-block mt-7 border border-line-strong px-6 py-2.5 rounded-[var(--radius-card)] text-sm hover:bg-paper-deep transition"
      >
        一覧へ戻る
      </Link>
    </div>
  );
}
