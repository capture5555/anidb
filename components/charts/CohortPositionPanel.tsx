import {
  QUADRANT_LABELS,
  QUADRANT_NOTES,
  type Quadrant,
  type WorkCohortPosition,
} from "@/lib/analytics/scorecard";

/**
 * 作品ページの「クール内ポジション」パネル（サーバーコンポーネント）。
 * 認知/熱量/満足/評価を 偏差値＋上位X% で示し、スリーパー/話題先行を明示する。
 * 作品ページ(/works/[id])・作品別分析ページ(/analytics/works/[id])で共用。
 */
export function CohortPositionPanel({ position }: { position: WorkCohortPosition }) {
  const { seasonLabel, cohortSize, work, commentary } = position;

  const metrics: { label: string; dev: number | null; pct: number | null }[] = [
    { label: "認知", dev: work.awarenessDev, pct: work.percentiles.awareness },
    { label: "熱量", dev: work.passionDev, pct: work.percentiles.passion },
    { label: "満足", dev: work.satisfactionDev, pct: work.percentiles.satisfaction },
    { label: "評価", dev: work.scoreDev, pct: work.percentiles.score },
  ].filter((m) => m.dev != null);

  return (
    <section className="card p-5 sm:p-6">
      <h2 className="section-title text-lg mb-1">
        クール内ポジション（{seasonLabel}・{cohortSize}作品中）
      </h2>
      <p className="text-xs text-muted mb-4">
        同じクールの放送作品の中で相対化した位置づけ（偏差値＝平均50）。
      </p>

      {/* 結論となる一言 */}
      <p className="text-sm sm:text-[0.95rem] font-bold text-ink leading-relaxed mb-4">{commentary}</p>

      {/* フラグのコールアウト */}
      {(work.sleeper || work.overhyped) && (
        <div
          className={`rounded-lg border-l-4 px-3 py-2 mb-4 ${
            work.sleeper ? "border-amber-400 bg-amber-50" : "border-line-strong bg-surface"
          }`}
        >
          <p className="text-xs font-bold text-ink-soft">
            {work.sleeper ? "過小評価／発掘候補（スリーパー）" : "話題先行"}
          </p>
          <p className="text-xs text-muted leading-relaxed mt-0.5">
            {work.sleeper
              ? "評価は高いが認知が追いついていません。早期に張ると先行者利益の余地があります。"
              : "認知の割に評価が伴っていません。初速以降の伸びは慎重に判断してください。"}
          </p>
        </div>
      )}

      {/* 指標バッジ（偏差値＋上位X%） */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {metrics.map((m) => (
          <MetricBadge key={m.label} label={m.label} dev={m.dev!} pct={m.pct} />
        ))}
      </div>

      {/* タイプ（4象限） */}
      <div className="mt-4 flex items-center gap-2 flex-wrap">
        <QuadrantTag q={work.quadrant} />
        <span className="text-xs text-muted leading-relaxed">{QUADRANT_NOTES[work.quadrant]}</span>
      </div>

      <p className="text-[0.7rem] text-muted mt-4 leading-relaxed">
        母数は各サービス利用者（テレビ視聴率ではない）。放送途中のスナップショットであり確定値ではありません。
      </p>
    </section>
  );
}

function MetricBadge({ label, dev, pct }: { label: string; dev: number; pct: number | null }) {
  // 50を基準に色付け（高い=朱寄り、低い=鈍色）。scorecard表の DevCell と同じ感覚。
  const color = dev >= 60 ? "text-accent" : dev >= 50 ? "text-ink" : "text-muted";
  return (
    <div className="border border-line rounded-lg px-3 py-2.5">
      <p className="text-[0.7rem] font-bold text-muted">{label}</p>
      <p className={`tabular-nums ${color}`}>
        <span className="text-xl font-black">偏差値 {dev.toFixed(0)}</span>
      </p>
      {pct != null && <p className="text-[0.7rem] text-ink-soft tabular-nums mt-0.5">上位{pct}%</p>}
    </div>
  );
}

function QuadrantTag({ q }: { q: Quadrant }) {
  const color: Record<Quadrant, string> = {
    royal: "#e8482f",
    wordofmouth: "#2ebd85",
    fastburn: "#f5a623",
    niche: "#9b59b6",
  };
  return (
    <span
      className="inline-block text-[0.66rem] font-bold px-2 py-0.5 rounded-full text-white whitespace-nowrap"
      style={{ backgroundColor: color[q] }}
    >
      {QUADRANT_LABELS[q]}
    </span>
  );
}
