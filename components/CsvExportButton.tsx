"use client";

/**
 * 表示中のテーブルデータを CSV としてダウンロードする小さなボタン。
 *
 * - フィールドにカンマ・引用符・改行が含まれる場合はダブルクオートで囲み、
 *   内部の `"` は `""` にエスケープする（RFC 4180 準拠）。
 * - 先頭に UTF-8 BOM を付与して Excel が日本語を文字化けせず開けるようにする。
 * - Blob + 一時的な <a> 要素でダウンロードを発火する（追加依存なし）。
 *
 * 既存の小ボタン（text-xs / border / rounded）に揃えた控えめなスタイル。
 */

function escapeField(value: string | number | null): string {
  const s = value == null ? "" : String(value);
  if (/[",\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function buildCsv(headers: string[], rows: (string | number | null)[][]): string {
  const lines = [headers, ...rows].map((row) => row.map(escapeField).join(","));
  // CRLF 区切り（Excel 互換）+ 先頭 BOM
  return "﻿" + lines.join("\r\n");
}

export function CsvExportButton({
  filename,
  headers,
  rows,
}: {
  filename: string;
  headers: string[];
  rows: (string | number | null)[][];
}) {
  const handleClick = () => {
    const csv = buildCsv(headers, rows);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename.endsWith(".csv") ? filename : `${filename}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      className="shrink-0 text-xs font-bold px-3 py-1 rounded-md border border-line text-ink-soft hover:border-line-strong hover:text-ink transition"
    >
      CSV出力
    </button>
  );
}
