/**
 * 実況コメントのリアクション分類の表示メタ（ラベル・色）。
 *
 * サーバーコンポーネントからも import できるよう、"use client" を付けない素のモジュールに置く。
 * （client コンポーネント MinuteHeatChart に置くと、サーバー側 import 時に値がプロキシ化され
 *   REACTION_META.map が壊れるため。色順は MinuteHeatChart の積み上げ順と一致させる。）
 */
export const REACTION_META: { key: string; label: string; color: string }[] = [
  { key: "laugh", label: "笑い", color: "#f5a623" },
  { key: "hype", label: "興奮", color: "#e8482f" },
  { key: "cry", label: "感動", color: "#2f6fdb" },
  { key: "surprise", label: "驚き", color: "#9b59b6" },
  { key: "sakuga", label: "作画", color: "#2ebd85" },
  { key: "scream", label: "絶叫", color: "#e84393" },
];

export const OTHER_COLOR = "#d4d9e2";
