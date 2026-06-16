/**
 * 自動インサイトのコールアウトブロック（サーバーコンポーネント）。
 *
 * props:
 *   title  — オプション。デフォルトは「自動インサイト」
 *   lines  — 表示するインサイト行。空配列のときは何も描画しない。
 */
export function AutoInsight({
  title = "自動インサイト",
  lines,
}: {
  title?: string;
  lines: string[];
}) {
  if (lines.length === 0) return null;

  return (
    <div className="rounded-lg border-l-4 border-line-strong bg-surface px-4 py-3 mb-4">
      <p className="text-[0.72rem] font-bold text-muted mb-1.5 tracking-wide">{title}</p>
      <ul className="space-y-1">
        {lines.map((line, i) => (
          <li key={i} className="text-sm text-ink leading-relaxed">
            {line}
          </li>
        ))}
      </ul>
    </div>
  );
}
