import { safeNextPath } from "@/lib/auth/gate";

export const dynamic = "force-dynamic";

export const metadata = { title: "ログイン" };

/**
 * 入口パスワード入力ページ。/api/gate へ POST する。
 * ミドルウェアが未認証アクセスをここへ集約する。
 */
export default async function GatePage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  const sp = await searchParams;
  const next = safeNextPath(sp.next ?? "/");
  const hasError = sp.error === "1";

  return (
    <div className="min-h-[70vh] flex items-center justify-center px-4">
      <div className="card w-full max-w-sm p-6 sm:p-8">
        <h1 className="text-lg font-black text-ink mb-1">アニメ作品データベース</h1>
        <p className="text-xs text-muted mb-5">
          このサイトはパスワードで保護されています。配布されたパスワードを入力してください。
        </p>
        <form method="post" action="/api/gate" className="space-y-3">
          <input type="hidden" name="next" value={next} />
          <input
            type="password"
            name="password"
            autoComplete="current-password"
            autoFocus
            required
            placeholder="パスワード"
            className="w-full rounded-lg border border-line bg-surface px-3 py-2.5 text-sm text-ink outline-none focus:border-primary"
          />
          {hasError && (
            <p className="text-xs font-bold text-rose-600">
              パスワードが違うか、有効期限・利用上限を超えています。
            </p>
          )}
          <button
            type="submit"
            className="w-full rounded-lg bg-primary text-white font-bold text-sm py-2.5 hover:opacity-90 transition"
          >
            入る
          </button>
        </form>
      </div>
    </div>
  );
}
