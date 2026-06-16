/**
 * 話数別の実況コメント数カーブから「急落・急増」を自動検出し、
 * その原因を推定した日本語コメントを生成するモジュール。
 *
 * 狙い: あかね噺の4話のように1話だけガクッと落ちるケースで、
 *   「本当に視聴者が離れたのか」「データ収集の取りこぼしか」を切り分ける。
 *
 * 収集ミスを疑う材料（このどれかが当たれば dataIssue 判定）:
 *   1. 実況チャンネルの切替 … その回だけ普段と違う局（BS/サブ局）の値になっている
 *   2. 尺の不足       … コメントの記録が普段より大幅に短い（放送途中までしか取れていない）
 *   3. 開始の繰り下がり … 冒頭しばらくコメントが無い（スポーツ中継等で放送が後ろにズレた）
 *   4. Annictとの乖離  … 実況は落ちたのにAnnictの記録ユーザー数は落ちていない（＝離脱ではない）
 *
 * 純粋な計算のみ。DBには触れず getWorkAnalysis の結果を受け取って判定する。
 */
import type { WorkAnalysis, EpisodeHeat, RetentionPoint } from "./viewing.ts";

export interface EpisodeNote {
  episodeLabel: string;
  kind: "drop" | "spike";
  /** データ収集側の問題が疑われるか（true=取りこぼしの可能性、false=実際の増減の可能性） */
  dataIssue: boolean;
  headline: string;
  detail: string;
  /** 判定の根拠（人が見て確かめられるように箇条書きで残す） */
  signals: string[];
}

export interface WorkCommentary {
  /** 全体傾向の一文（話数が揃っていれば必ず付く） */
  summary: string | null;
  notes: EpisodeNote[];
}

// 急落・急増の閾値（前後話の平均比）
const DROP_RATIO = 0.6; // 前後平均の60%以下 = 急落
const SPIKE_RATIO = 1.8; // 前後平均の1.8倍以上 = 急増
const ANNICT_FLAT = 0.85; // Annictが前後平均の85%以上を保っていれば「落ちていない」

const median = (xs: number[]): number => {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/** 前後の話の平均（端は存在する片側のみ）。隣が無ければ null */
const neighborAvg = (xs: number[], i: number): number | null => {
  const ns: number[] = [];
  if (i - 1 >= 0) ns.push(xs[i - 1]);
  if (i + 1 < xs.length) ns.push(xs[i + 1]);
  if (ns.length === 0) return null;
  return ns.reduce((a, b) => a + b, 0) / ns.length;
};

/** コメントが実際に記録されている時間帯（最初の分・最後の分・尺） */
const coverage = (ep: EpisodeHeat): { firstMin: number; lastMin: number; span: number } | null => {
  const withC = ep.points.filter((p) => p.total > 0);
  if (withC.length === 0) return null;
  const firstMin = withC[0].minute;
  const lastMin = withC[withC.length - 1].minute;
  return { firstMin, lastMin, span: lastMin - firstMin + 1 };
};

const labelOf = (ep: EpisodeHeat): string => ep.episodeLabel || "放送回";
const normLabel = (s: string | null): string => (s ?? "").replace(/\s/g, "");

/** Annictの話数別カーブを、実況の話ラベルで引けるマップにする */
const annictByLabel = (points: RetentionPoint[]): Map<string, number> => {
  const m = new Map<string, number>();
  for (const p of points) if (p.numberText) m.set(normLabel(p.numberText), p.pct);
  return m;
};

/**
 * 作品の話数別コメント数を分析し、急落・急増の自動コメントを返す。
 * 話数が3話に満たない場合は傾向判定をしない（summaryのみ、または空）。
 */
export function buildEpisodeCommentary(analysis: WorkAnalysis): WorkCommentary {
  const eps = analysis.episodes;
  if (eps.length < 3) return { summary: null, notes: [] };

  const counts = eps.map((e) => e.totalComments);
  const medCount = median(counts); // 急増判定の基準（外れ値に強い中央値）
  const covs = eps.map(coverage);
  const medSpan = median(covs.filter((c): c is NonNullable<typeof c> => c != null).map((c) => c.span));
  const medFirst = median(covs.filter((c): c is NonNullable<typeof c> => c != null).map((c) => c.firstMin));

  // 普段の代表チャンネル（最頻）。その回だけ違えば切替の疑い
  const chCount = new Map<string, number>();
  for (const e of eps) if (e.channelName) chCount.set(e.channelName, (chCount.get(e.channelName) ?? 0) + 1);
  const mainChannel = [...chCount.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

  const annict = annictByLabel(analysis.annictPoints);

  const notes: EpisodeNote[] = [];

  for (let i = 0; i < eps.length; i++) {
    const ep = eps[i];
    const base = neighborAvg(counts, i);
    if (base == null || base <= 0) continue;
    const ratio = counts[i] / base;

    if (ratio <= DROP_RATIO) {
      const pctDown = Math.round((1 - ratio) * 100);
      const signals: string[] = [];

      // 1. チャンネル切替
      const channelSwitch =
        mainChannel != null && ep.channelName != null && ep.channelName !== mainChannel;
      if (channelSwitch) {
        signals.push(
          `この回だけ実況チャンネルが「${ep.channelName}」（通常は「${mainChannel}」）。サブ局/BSの少ない値を拾っている可能性`,
        );
      }

      // 2. 尺の不足（放送途中までしか取れていない）
      const cov = covs[i];
      const truncated = cov != null && medSpan > 0 && cov.span < medSpan * 0.6;
      if (truncated) {
        signals.push(
          `コメントの記録が約${cov!.span}分しか無く、通常（約${Math.round(medSpan)}分）より大幅に短い。放送途中までしか収集できていない可能性`,
        );
      }

      // 3. 開始の繰り下がり（冒頭にコメントが無い）
      const lateStart = cov != null && cov.firstMin >= medFirst + 6;
      if (lateStart) {
        signals.push(
          `開始から約${cov!.firstMin}分間コメントが無い。スポーツ中継等で放送が繰り下がり、ズレた時間帯を収集した可能性`,
        );
      }

      // 4. Annictとの乖離（実況は落ちたが記録ユーザー数は落ちていない）
      let annictFlat = false;
      const aHere = annict.get(normLabel(ep.episodeLabel));
      const aPrev = i - 1 >= 0 ? annict.get(normLabel(eps[i - 1].episodeLabel)) : undefined;
      const aNext = i + 1 < eps.length ? annict.get(normLabel(eps[i + 1].episodeLabel)) : undefined;
      const aNeigh = [aPrev, aNext].filter((x): x is number => x != null);
      if (aHere != null && aNeigh.length > 0) {
        const aBase = aNeigh.reduce((a, b) => a + b, 0) / aNeigh.length;
        if (aBase > 0 && aHere >= aBase * ANNICT_FLAT) {
          annictFlat = true;
          signals.push(
            `Annictの記録ユーザー数はこの回で落ちていない（前後とほぼ同水準）。視聴者が離れたのではなく実況の取りこぼしと考えられる`,
          );
        }
      }

      const dataIssue = channelSwitch || truncated || lateStart || annictFlat;

      let headline: string;
      let detail: string;
      if (dataIssue) {
        headline = `「${labelOf(ep)}」の落ち込みはデータ収集側の問題の可能性が高い`;
        detail =
          `前後の回より約${pctDown}%少なくなっていますが、下記の理由から実際に視聴者が減ったというより` +
          `ニコニコ実況の取りこぼしの可能性が高いです。生ログ（analytics_jikkyo_comments）から再収集・再集計すると改善する場合があります。`;
      } else {
        headline = `「${labelOf(ep)}」でコメントが大きく落ち込んでいる`;
        detail =
          `前後の回より約${pctDown}%少なく、実況チャンネル・収集の尺・Annict記録数に不自然な点は見当たりません。` +
          `放送時間帯（深夜・裏番組）や話の内容による実際の落ち込みと考えられます。`;
        const sat = satisfactionFor(analysis, ep);
        if (sat != null) {
          detail += `なお同話のAnnict満足度は${sat}%です。`;
        }
      }

      notes.push({ episodeLabel: labelOf(ep), kind: "drop", dataIssue, headline, detail, signals });
    } else if (medCount > 0 && counts[i] >= SPIKE_RATIO * medCount) {
      // 急増は中央値基準で判定（落ち込んだ隣の回につられて誤検知しないように）
      const pctUp = Math.round((counts[i] / medCount - 1) * 100);
      notes.push({
        episodeLabel: labelOf(ep),
        kind: "spike",
        dataIssue: false,
        headline: `「${labelOf(ep)}」が大きく盛り上がっている`,
        detail: `前後の回より約${pctUp}%多くコメントが付いています。話の内容や話題性で実況が伸びた回と考えられます。`,
        signals: [],
      });
    }
  }

  return { summary: buildSummary(eps), notes };
}

/** Annict満足度（同話ラベル）を引く */
function satisfactionFor(analysis: WorkAnalysis, ep: EpisodeHeat): number | null {
  const key = normLabel(ep.episodeLabel);
  const p = analysis.satisfactionPoints.find((s) => normLabel(s.numberText) === key);
  return p ? p.rate : null;
}

/** 全体傾向の一文（最多回・直近の初回比） */
function buildSummary(eps: EpisodeHeat[]): string {
  const peak = eps.reduce((a, b) => (b.totalComments > a.totalComments ? b : a), eps[0]);
  const first = eps[0].totalComments;
  const last = eps[eps.length - 1].totalComments;
  const parts: string[] = [
    `全${eps.length}話で最も実況が伸びたのは「${peak.episodeLabel}」（${peak.totalComments.toLocaleString()}コメント）。`,
  ];
  if (first > 0) {
    const pct = Math.round((last / first) * 100);
    parts.push(`直近回は初回の約${pct}%です。`);
  }
  return parts.join("");
}
