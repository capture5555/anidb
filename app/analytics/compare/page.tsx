/**
 * 作品比較モード — 複数作品を横並びで指標比較するページ。
 *
 * URL: /analytics/compare?ids=a,b,c（カンマ区切り・最大3件）
 * 作品追加: <form method="get"> + <select name="add"> → サーバー側で ids にマージ
 *
 * すべてサーバーコンポーネント。取得失敗は —/空状態（throwしない）。
 */
export const revalidate = 1800;

import Link from "next/link";
import type { Metadata } from "next";
import { WorkCover } from "@/components/WorkCover";
import {
  getWorksCompareData,
  getCurrentSeasonWorks,
  type WorkCompareData,
} from "@/lib/analytics/compareWorks";

export const metadata: Metadata = { title: "作品比較 | アニメ分析" };

// ---------------------------------------------------------------- URL helpers

/** カンマ区切りの ids 文字列をパースし最大 3 件に絞る */
function parseIds(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 3);
}

/** ids 配列を URL の ids パラメータ文字列に変換 */
function toIdsParam(ids: string[]): string {
  return ids.join(",");
}

/** ある id を除いた新しい ids の URL */
function removeUrl(ids: string[], removeId: string): string {
  const next = ids.filter((id) => id !== removeId);
  if (next.length === 0) return "/analytics/compare";
  return `/analytics/compare?ids=${toIdsParam(next)}`;
}

// ---------------------------------------------------------------- 最良値ハイライト

type NumericKey =
  | "overallScore"
  | "fastStartScore"
  | "xBuzzVolume"
  | "latestSatisfaction"
  | "totalComments"
  | "cohortDeviation";

/**
 * 比較データ配列の中で指定フィールドが最大の workId を返す。
 * null / undefined しかなければ null。
 */
function bestWorkId(works: WorkCompareData[], key: NumericKey): string | null {
  let best: { id: string; val: number } | null = null;
  for (const w of works) {
    const v = w[key];
    if (v == null) continue;
    if (best == null || v > best.val) best = { id: w.workId, val: v };
  }
  return best?.id ?? null;
}

// ---------------------------------------------------------------- sentiment display

function sentimentLabel(s: string | null | undefined): string | null {
  if (!s) return null;
  const l = s.toLowerCase();
  if (l.includes("positive") || l.includes("ポジティブ")) return "好意的";
  if (l.includes("negative") || l.includes("ネガティブ")) return "批判的";
  if (l.includes("mixed") || l.includes("混合")) return "賛否";
  return null;
}

function sentimentClass(s: string | null | undefined): string {
  if (!s) return "text-muted";
  const l = s.toLowerCase();
  if (l.includes("positive") || l.includes("ポジティブ"))
    return "text-emerald-600 font-bold";
  if (l.includes("negative") || l.includes("ネガティブ"))
    return "text-rose-600 font-bold";
  return "text-amber-600 font-bold";
}

// ---------------------------------------------------------------- cell helpers

/** セルの基本スタイル */
function cellBase(isBest: boolean): string {
  return isBest
    ? "text-accent font-black tabular-nums"
    : "text-ink tabular-nums";
}

// ---------------------------------------------------------------- sub-components

/** Xバズ volume のゲージ（0〜5）*/
function VolumeGauge({ volume, isBest }: { volume: number; isBest: boolean }) {
  const filled = Math.max(0, Math.min(5, Math.round(volume)));
  return (
    <div
      className="flex items-center gap-0.5 justify-center"
      aria-label={`${volume.toFixed(1)}/5`}
    >
      {[0, 1, 2, 3, 4].map((i) => (
        <span
          key={i}
          className={`h-2.5 w-4 rounded-[2px] ${
            i < filled ? (isBest ? "bg-accent" : "bg-accent/60") : "bg-paper"
          }`}
        />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------- main page

export default async function ComparePage({
  searchParams,
}: {
  searchParams: Promise<{ ids?: string; add?: string }>;
}) {
  const sp = await searchParams;

  // ids の解析 + add のマージ（4件以上・重複は無視）
  const rawIds = parseIds(sp.ids);
  let ids = rawIds;
  if (sp.add) {
    const addId = sp.add.trim();
    if (addId && !ids.includes(addId) && ids.length < 3) {
      ids = [...ids, addId];
    }
  }

  // 並列データ取得
  const [works, seasonWorks] = await Promise.all([
    ids.length > 0 ? getWorksCompareData(ids) : Promise.resolve([]),
    getCurrentSeasonWorks().catch(() => []),
  ]);

  // add 後のリダイレクト相当の URL（フォーム送信後のきれいな URL を表示）
  const currentUrl =
    ids.length > 0 ? `/analytics/compare?ids=${toIdsParam(ids)}` : "/analytics/compare";

  // 既に比較中の作品を select から除外
  const selectableWorks = seasonWorks.filter((w) => !ids.includes(w.id));
  const canAddMore = ids.length < 3;

  return (
    <div className="mx-auto max-w-6xl px-4 sm:px-6 pb-16">
      {/* パンくず */}
      <div className="pt-4 text-xs text-muted">
        <Link href="/analytics" className="hover:text-primary">
          アニメ分析
        </Link>
        <span className="mx-1.5">›</span>
        <span className="text-ink-soft">作品比較</span>
      </div>

      <h1 className="text-xl sm:text-2xl font-black text-ink mt-3 mb-4">作品比較</h1>

      {/* 作品追加フォーム */}
      {canAddMore && selectableWorks.length > 0 && (
        <form method="get" action="/analytics/compare" className="card p-4 sm:p-5 mb-5">
          {/* 現在の ids を hidden で保持 */}
          {ids.length > 0 && (
            <input type="hidden" name="ids" value={toIdsParam(ids)} />
          )}
          <p className="text-xs font-bold text-muted mb-2">
            比較に追加する作品を選択（最大3作品）
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <select
              name="add"
              className="flex-1 min-w-0 border border-line rounded-md px-3 py-1.5 text-sm bg-surface text-ink focus:outline-none focus:ring-2 focus:ring-accent/30"
              defaultValue=""
            >
              <option value="" disabled>
                今期の作品を選択…
              </option>
              {selectableWorks.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.title}
                </option>
              ))}
            </select>
            <button
              type="submit"
              className="shrink-0 px-4 py-1.5 rounded-md bg-accent text-white text-sm font-bold hover:opacity-90 transition"
            >
              追加
            </button>
          </div>
        </form>
      )}

      {/* 空状態 */}
      {ids.length === 0 && (
        <div className="card p-8 text-center text-muted">
          <p className="text-sm">比較する作品を選んでください。</p>
          <p className="text-xs mt-1">
            上のセレクトから今期作品を選ぶか、各作品詳細ページの「他作品と比較 →」から追加できます。
          </p>
        </div>
      )}

      {/* 比較テーブル */}
      {works.length > 0 && (
        <CompareTable works={works} ids={ids} currentUrl={currentUrl} />
      )}
    </div>
  );
}

// ---------------------------------------------------------------- 比較テーブル

function CompareTable({
  works,
  ids,
  currentUrl: _currentUrl,
}: {
  works: WorkCompareData[];
  ids: string[];
  currentUrl: string;
}) {
  // 各指標の最良 workId
  const bestOverall = bestWorkId(works, "overallScore");
  const bestFastStart = bestWorkId(works, "fastStartScore");
  const bestXBuzz = bestWorkId(works, "xBuzzVolume");
  const bestSat = bestWorkId(works, "latestSatisfaction");
  const bestComments = bestWorkId(works, "totalComments");
  const bestCohort = bestWorkId(works, "cohortDeviation");

  const colCount = works.length;
  // グリッド列クラス
  const gridCols =
    colCount === 1
      ? "grid-cols-[180px_1fr]"
      : colCount === 2
        ? "grid-cols-[180px_1fr_1fr]"
        : "grid-cols-[180px_1fr_1fr_1fr]";

  return (
    <div className="overflow-x-auto">
      <div className={`grid ${gridCols} min-w-[560px]`} style={{ minWidth: 560 }}>
        {/* ヘッダー行 */}
        {/* 空の行ラベル列ヘッダー */}
        <div className="border-b border-line p-3" />
        {works.map((w) => {
          const excludeUrl = removeUrl(ids, w.workId);
          return (
            <div
              key={w.workId}
              className={`border-b border-line p-3 flex flex-col items-center gap-2 ${
                works.length > 1 ? "border-l border-line" : ""
              }`}
            >
              <Link href={`/analytics/works/${w.workId}`} className="shrink-0">
                <WorkCover
                  id={w.workId}
                  title={w.title}
                  url={w.posterUrl}
                  className="w-14 h-[4.5rem] sm:w-16 sm:h-[5.5rem] rounded-lg"
                />
              </Link>
              <Link
                href={`/analytics/works/${w.workId}`}
                className="text-xs font-bold text-ink hover:text-primary transition text-center leading-snug line-clamp-3"
              >
                {w.title}
              </Link>
              <Link
                href={excludeUrl}
                className="text-[0.65rem] text-muted hover:text-rose-500 transition font-bold"
              >
                ×除外
              </Link>
            </div>
          );
        })}

        {/* 行: 総合スコア */}
        <RowLabel label="総合スコア" note="0〜100pt" />
        {works.map((w) => {
          const isBest = w.workId === bestOverall;
          return (
            <DataCell key={w.workId} isBest={isBest} first={works[0].workId === w.workId}>
              {w.overallScore != null ? (
                <div className={cellBase(isBest)}>
                  <span className="text-xl">{w.overallScore.toFixed(0)}</span>
                  <span className="text-xs font-normal text-muted ml-0.5">pt</span>
                  {w.overallRank != null && w.overallTotal != null && (
                    <div className="text-[0.65rem] text-muted font-normal mt-0.5">
                      {w.overallTotal}作中{w.overallRank}位
                    </div>
                  )}
                </div>
              ) : (
                <Dash />
              )}
            </DataCell>
          );
        })}

        {/* 行: 初速スコア */}
        <RowLabel label="初速スコア" note="第1話立ち上がり" />
        {works.map((w) => {
          const isBest = w.workId === bestFastStart;
          return (
            <DataCell key={w.workId} isBest={isBest} first={works[0].workId === w.workId}>
              {w.fastStartScore != null ? (
                <div className={cellBase(isBest)}>
                  <span className="text-xl">{w.fastStartScore.toFixed(0)}</span>
                  <span className="text-xs font-normal text-muted ml-0.5">pt</span>
                  {w.fastStartRank != null && w.fastStartTotal != null && (
                    <div className="text-[0.65rem] text-muted font-normal mt-0.5">
                      {w.fastStartTotal}作中{w.fastStartRank}位
                    </div>
                  )}
                </div>
              ) : (
                <Dash />
              )}
            </DataCell>
          );
        })}

        {/* 行: X バズ */}
        <RowLabel label="X バズ" note="0〜5 + 感情" />
        {works.map((w) => {
          const isBest = w.workId === bestXBuzz;
          const sentLabel = sentimentLabel(w.xBuzzSentiment);
          const sentCls = sentimentClass(w.xBuzzSentiment);
          return (
            <DataCell key={w.workId} isBest={isBest} first={works[0].workId === w.workId}>
              {w.xBuzzVolume != null ? (
                <div className="flex flex-col items-center gap-1">
                  <VolumeGauge volume={w.xBuzzVolume} isBest={isBest} />
                  <span className={`text-sm ${cellBase(isBest)}`}>
                    {w.xBuzzVolume.toFixed(1)}
                    <span className="text-xs font-normal text-muted">/5</span>
                  </span>
                  {sentLabel && (
                    <span className={`text-[0.65rem] ${sentCls}`}>{sentLabel}</span>
                  )}
                </div>
              ) : (
                <Dash />
              )}
            </DataCell>
          );
        })}

        {/* 行: 最新話満足度 */}
        <RowLabel label="最新話満足度" note="Annict 良い率%" />
        {works.map((w) => {
          const isBest = w.workId === bestSat;
          return (
            <DataCell key={w.workId} isBest={isBest} first={works[0].workId === w.workId}>
              {w.latestSatisfaction != null ? (
                <div className={cellBase(isBest)}>
                  <span className="text-xl">{w.latestSatisfaction.toFixed(0)}</span>
                  <span className="text-xs font-normal text-muted ml-0.5">%</span>
                  {/* バー */}
                  <div className="mt-1.5 h-1 rounded-full bg-surface-alt overflow-hidden w-full max-w-[60px]">
                    <div
                      className={`h-full rounded-full ${isBest ? "bg-accent" : "bg-accent/50"}`}
                      style={{
                        width: `${Math.min(100, Math.max(2, w.latestSatisfaction))}%`,
                      }}
                    />
                  </div>
                </div>
              ) : (
                <Dash />
              )}
            </DataCell>
          );
        })}

        {/* 行: 実況コメント総数 */}
        <RowLabel label="実況コメント" note="ニコニコ全話合計" />
        {works.map((w) => {
          const isBest = w.workId === bestComments;
          return (
            <DataCell key={w.workId} isBest={isBest} first={works[0].workId === w.workId}>
              {w.totalComments != null ? (
                <div className={cellBase(isBest)}>
                  <span className="text-xl">
                    {w.totalComments >= 10000
                      ? `${Math.round(w.totalComments / 1000)}k`
                      : w.totalComments.toLocaleString()}
                  </span>
                  <span className="text-xs font-normal text-muted ml-0.5">コメ</span>
                </div>
              ) : (
                <Dash />
              )}
            </DataCell>
          );
        })}

        {/* 行: クール内偏差値 */}
        <RowLabel label="クール内偏差値" note="mean50/SD10" />
        {works.map((w) => {
          const isBest = w.workId === bestCohort;
          return (
            <DataCell key={w.workId} isBest={isBest} first={works[0].workId === w.workId}>
              {w.cohortDeviation != null ? (
                <div className={cellBase(isBest)}>
                  <span className="text-xl">{w.cohortDeviation.toFixed(0)}</span>
                  {w.cohortPercentile != null && (
                    <div className="text-[0.65rem] text-muted font-normal mt-0.5">
                      上位{w.cohortPercentile}%
                      {w.cohortSize != null && ` / ${w.cohortSize}作`}
                    </div>
                  )}
                </div>
              ) : (
                <Dash />
              )}
            </DataCell>
          );
        })}

        {/* 行: ジャンル */}
        <RowLabel label="ジャンル" note="" />
        {works.map((w) => (
          <DataCell key={w.workId} isBest={false} first={works[0].workId === w.workId}>
            {w.genres.length > 0 ? (
              <div className="flex flex-wrap gap-1 justify-center">
                {w.genres.slice(0, 4).map((g) => (
                  <span
                    key={g}
                    className="inline-block text-[0.62rem] px-1.5 py-0.5 rounded-full bg-paper border border-line text-ink-soft"
                  >
                    {g}
                  </span>
                ))}
              </div>
            ) : (
              <Dash />
            )}
          </DataCell>
        ))}
      </div>

      <p className="text-[0.65rem] text-muted mt-4 leading-relaxed">
        ※ 太字・アクセント色 = その指標で最良の作品。値なしは「—」。<br />
        データソース: ニコニコ実況・Annict・X(Grok x_search)。各サービス利用者を母数とした参考値。
      </p>
    </div>
  );
}

// ---------------------------------------------------------------- 行ラベルセル

function RowLabel({ label, note }: { label: string; note: string }) {
  return (
    <div className="border-b border-line p-3 flex flex-col justify-center bg-paper/30">
      <span className="text-xs font-bold text-ink leading-snug">{label}</span>
      {note && <span className="text-[0.62rem] text-muted mt-0.5">{note}</span>}
    </div>
  );
}

// ---------------------------------------------------------------- データセル

function DataCell({
  children,
  isBest,
  first,
}: {
  children: React.ReactNode;
  isBest: boolean;
  first: boolean;
}) {
  return (
    <div
      className={`border-b border-line p-3 flex items-center justify-center ${
        !first ? "border-l border-line" : ""
      } ${isBest ? "bg-accent/5" : ""}`}
    >
      {children}
    </div>
  );
}

// ---------------------------------------------------------------- ダッシュ（値なし）

function Dash() {
  return <span className="text-muted text-sm">—</span>;
}
