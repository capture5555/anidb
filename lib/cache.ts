/**
 * フレームワーク非依存の小さなインメモリ TTL メモ化ヘルパー。
 *
 * force-dynamic ページのレンダリングごとに走る重い集計クエリ（クール診断・
 * スコアカード等）を、プロセス内のメモリに短時間だけキャッシュして DB 負荷を下げる。
 *
 * - module スコープの Map（key → { value: Promise<R>; expires: number }）に保持。
 * - 呼び出し時、未失効のエントリがあればそれを返す（= 同時実行は同じ Promise を共有）。
 * - 無ければ fn を実行し、その Promise をそのまま格納（expires = now + ttlMs）。
 * - Promise が reject した場合はエントリを削除し、失敗をキャッシュしない。
 *
 * SSR/build を壊さないため副作用は持たず、純粋にメモリ上のみで完結する。
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function memoizeTTL<A extends any[], R>(
  fn: (...a: A) => Promise<R>,
  keyFn: (...a: A) => string,
  ttlMs: number,
): (...a: A) => Promise<R> {
  const store = new Map<string, { value: Promise<R>; expires: number }>();

  return (...args: A): Promise<R> => {
    const key = keyFn(...args);
    const now = Date.now();
    const hit = store.get(key);
    if (hit && hit.expires > now) {
      return hit.value;
    }

    const value = fn(...args);
    store.set(key, { value, expires: now + ttlMs });

    // reject はキャッシュしない（次回は再実行させる）。
    // 現在格納中のエントリだけを消す（後続の再実行で差し替わっていれば触らない）。
    value.catch(() => {
      const cur = store.get(key);
      if (cur && cur.value === value) store.delete(key);
    });

    return value;
  };
}
