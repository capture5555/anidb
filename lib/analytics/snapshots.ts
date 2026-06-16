/**
 * 解析スナップショットの読み書き層。
 *
 * 重い全件集計（クール診断・スタジオ/人材スコアカード・ジャンル動向・視聴分析など）を
 * リクエスト経路から外し、外部 cron（scripts/compute-snapshots.ts）で事前計算した結果を
 * analytics_snapshots テーブルに保存しておき、ページはそれを読むだけにする。
 *
 * 重要: スナップショットの読み取りは「防御的」でなければならない。
 *   - マイグレーション 0011 適用前 → テーブルが存在しない
 *   - 初回 cron 実行前 → 行が存在しない
 * いずれの場合も「クラッシュさせず LIVE 計算へフォールバック」する（fromSnapshotOrLive）。
 */
import { getAdminClient } from "../supabase/admin.ts";

/**
 * analytics_snapshots から key の payload を読む。
 * テーブル/行が無い・DBエラー等、いかなる失敗でも null を返す（例外を投げない）。
 */
export async function readSnapshot<T>(key: string): Promise<T | null> {
  try {
    const db = getAdminClient();
    const { data, error } = await db
      .from("analytics_snapshots")
      .select("payload")
      .eq("key", key)
      .maybeSingle();
    if (error || !data) return null;
    return (data.payload ?? null) as T | null;
  } catch {
    // テーブル未作成（マイグレーション前）・接続エラー等 → LIVE フォールバック
    return null;
  }
}

/**
 * analytics_snapshots に {key, payload, computed_at: now} を upsert する。
 * 主に compute-snapshots スクリプトから呼ぶ。
 */
export async function writeSnapshot(key: string, payload: unknown): Promise<void> {
  const db = getAdminClient();
  const { error } = await db
    .from("analytics_snapshots")
    .upsert(
      { key, payload, computed_at: new Date().toISOString() },
      { onConflict: "key" },
    );
  if (error) throw error;
}

/**
 * 読み取り経路のラッパー。スナップショットがあればそれを、無ければ live() を返す。
 * スナップショットの欠如（テーブル/行なし）は readSnapshot 側で null に正規化されるため、
 * ここでは単純に null 合体すればよい。
 */
export async function fromSnapshotOrLive<T>(key: string, live: () => Promise<T>): Promise<T> {
  return (await readSnapshot<T>(key)) ?? (await live());
}
