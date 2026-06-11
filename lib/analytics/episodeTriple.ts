/**
 * 「話数別 3面比較」用の純関数。
 *
 * 3系列 (実況コメント密度 / Annict満足度 / Xバズ) を話数(エピソード番号)で突き合わせ、
 * 各指標を 0〜100 に正規化した上で EpisodeTriplePoint[] を返す。
 *
 * 結合キーの優先順:
 *   1. episodeId が両データセットに共通で存在する場合はそれで突き合わせる。
 *   2. episodeId が使えない場合は episodeNumber で突き合わせる。
 *
 * 欠測（データが無い話）はその系列の値を null で表す（防御的）。
 * 3系列がすべて空/欠測ならば null を返す。
 * 実データが 2 話未満なら null を返す（母数が薄すぎるため非表示）。
 */

import type { WorkAnalysis } from "./viewing.js";
import type { EpisodeXBuzz } from "./xbuzz.js";

export interface EpisodeTriplePoint {
  /** 横軸用: 1始まりの通し番号（突き合わせ後のソート順） */
  episodeIndex: number;
  /** 表示ラベル（例: "第1話"）*/
  label: string;
  /** 実況コメント密度: 系列内最大=100 の相対値。データ無しは null。 */
  commentNorm: number | null;
  /** Annict満足度: rate(%) をそのまま 0〜100 で使う。データ無しは null。 */
  satisfactionNorm: number | null;
  /** Xバズ: volume(0〜5) × 20 で 0〜100 へ変換。データ無しは null。 */
  xbuzzNorm: number | null;
}

export interface EpisodeTripleData {
  points: EpisodeTriplePoint[];
  /** 実際に値が入っている系列の有無フラグ（凡例の表示制御に使う） */
  hasComment: boolean;
  hasSatisfaction: boolean;
  hasXBuzz: boolean;
}

/**
 * WorkAnalysis と EpisodeXBuzz[] を突き合わせて EpisodeTripleData を構築する純関数。
 * データが不十分な場合は null を返す。
 */
export function buildEpisodeTriple(
  analysis: WorkAnalysis,
  xbuzzEpisodes: EpisodeXBuzz[],
): EpisodeTripleData | null {
  // ---- 1. 実況コメント密度: episodes[].totalComments を episodeId/番号 でインデックス化 ----
  // EpisodeHeat は episodeId(null 可)・episodeLabel を持つ。
  // 話数番号は配列の並び順(sort順)を 1 始まりとして使う（WorkAnalysis の episodes は sort済み）。
  const commentByEpId = new Map<string, { index: number; label: string; total: number }>();
  const commentByEpNum = new Map<number, { index: number; label: string; total: number }>();

  analysis.episodes.forEach((ep, i) => {
    const idx = i + 1;
    const entry = { index: idx, label: ep.episodeLabel, total: ep.totalComments };
    if (ep.episodeId) commentByEpId.set(ep.episodeId, entry);
    // episodeLabel から番号を推定する（補助キー）
    // episodeLabel は "第N話" 形式のことが多い
  });

  // ---- 2. 満足度: satisfactionPoints は episodeNumber(1始まり) + numberText を持つ ----
  const satisfactionByNum = new Map<
    number,
    { label: string | null; rate: number }
  >();
  for (const sp of analysis.satisfactionPoints) {
    satisfactionByNum.set(sp.episodeNumber, { label: sp.numberText, rate: sp.rate });
  }

  // ---- 3. Xバズ: episodeId と episodeNumber で突き合わせる ----
  const xbuzzByEpId = new Map<string, { epNum: number | null; label: string; volume: number }>();
  const xbuzzByEpNum = new Map<number, { label: string; volume: number }>();
  for (const xe of xbuzzEpisodes) {
    if (xe.episodeId) {
      xbuzzByEpId.set(xe.episodeId, {
        epNum: xe.episodeNumber,
        label: xe.episodeLabel,
        volume: xe.volume,
      });
    }
    if (xe.episodeNumber != null) {
      // episodeNumber が同じ複数行がある場合は最初の行（= captured_at 降順で最新）を採用
      if (!xbuzzByEpNum.has(xe.episodeNumber)) {
        xbuzzByEpNum.set(xe.episodeNumber, { label: xe.episodeLabel, volume: xe.volume });
      }
    }
  }

  // ---- 4. 話数を列挙してマージ ----
  // 軸となる話数セットは実況コメントの話数を優先し、Annict満足度・Xバズで補完する。
  // 実況コメントが無ければ Annict 満足度の episodeNumber を軸にする。

  // まず実況コメントの話数インデックス(1始まり連番)ごとに行を作る
  type MergeRow = {
    episodeIndex: number;
    label: string;
    episodeId: string | null;
    // episodeNumber: satisfactionPoints が使う 1始まり番号
    episodeNum: number;
    totalComments: number | null;
  };

  const rows: MergeRow[] = [];

  if (analysis.episodes.length > 0) {
    analysis.episodes.forEach((ep, i) => {
      rows.push({
        episodeIndex: i + 1,
        label: ep.episodeLabel,
        episodeId: ep.episodeId,
        episodeNum: i + 1,
        totalComments: ep.totalComments > 0 ? ep.totalComments : null,
      });
    });
  } else if (analysis.satisfactionPoints.length > 0) {
    for (const sp of analysis.satisfactionPoints) {
      rows.push({
        episodeIndex: sp.episodeNumber,
        label: sp.numberText ?? `${sp.episodeNumber}話`,
        episodeId: null,
        episodeNum: sp.episodeNumber,
        totalComments: null,
      });
    }
  }

  if (rows.length === 0) return null;

  // ---- 5. 正規化: 実況コメントは系列内最大=100 ----
  const maxComments = Math.max(
    ...rows.map((r) => r.totalComments ?? 0),
    1, // ゼロ除算ガード
  );

  // ---- 6. 各行に満足度・Xバズを突き合わせる ----
  const points: EpisodeTriplePoint[] = rows.map((row) => {
    // コメント正規化
    const commentNorm =
      row.totalComments != null
        ? Math.round((row.totalComments / maxComments) * 100)
        : null;

    // 満足度: episodeNum で突き合わせ
    const sat = satisfactionByNum.get(row.episodeNum);
    const satisfactionNorm =
      sat != null && !Number.isNaN(sat.rate)
        ? Math.min(100, Math.max(0, Math.round(sat.rate * 10) / 10))
        : null;

    // Xバズ: episodeId → episodeNum の順で突き合わせ
    let xbuzzVol: number | null = null;
    if (row.episodeId && xbuzzByEpId.has(row.episodeId)) {
      xbuzzVol = xbuzzByEpId.get(row.episodeId)!.volume;
    } else if (xbuzzByEpNum.has(row.episodeNum)) {
      xbuzzVol = xbuzzByEpNum.get(row.episodeNum)!.volume;
    }
    const xbuzzNorm =
      xbuzzVol != null
        ? Math.min(100, Math.max(0, Math.round(xbuzzVol * 20)))
        : null;

    return {
      episodeIndex: row.episodeIndex,
      label: row.label,
      commentNorm,
      satisfactionNorm,
      xbuzzNorm,
    };
  });

  // ---- 7. 3系列とも欠測なポイントは存在するが全体の有無フラグを確認 ----
  const hasComment = points.some((p) => p.commentNorm != null);
  const hasSatisfaction = points.some((p) => p.satisfactionNorm != null);
  const hasXBuzz = points.some((p) => p.xbuzzNorm != null);

  // 3系列がすべて空なら非表示
  if (!hasComment && !hasSatisfaction && !hasXBuzz) return null;

  // 何らかの値が存在するポイントが2未満なら母数薄すぎとして非表示
  const filledPoints = points.filter(
    (p) => p.commentNorm != null || p.satisfactionNorm != null || p.xbuzzNorm != null,
  );
  if (filledPoints.length < 2) return null;

  return { points, hasComment, hasSatisfaction, hasXBuzz };
}
