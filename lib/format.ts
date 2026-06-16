const WD = ["日", "月", "火", "水", "木", "金", "土"];

const TZ = "Asia/Tokyo";

/** ISO -> "4/3(金) 23:00" */
export function formatAirShort(iso: string): string {
  const d = new Date(iso);
  const parts = new Intl.DateTimeFormat("ja-JP", {
    timeZone: TZ,
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    weekday: "short",
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("month")}/${get("day")}(${get("weekday")}) ${get("hour")}:${get("minute")}`;
}

export const WEEKDAY_LABELS = ["日", "月", "火", "水", "木", "金", "土"];

/**
 * 放送枠を求める。深夜帯（0〜4時台）はアニメ慣習に合わせ前日扱い＋25:00表記にする。
 * 例: 土曜 01:00 → { weekday: 5(金), label: "25:00" }
 */
export function airSlot(iso: string): { weekday: number; hour: number; minute: number; label: string } {
  const d = new Date(iso);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TZ,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const wdMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  let weekday = wdMap[get("weekday")] ?? 0;
  let hour = Number(get("hour")) % 24;
  const minute = Number(get("minute"));
  if (hour < 5) {
    weekday = (weekday + 6) % 7; // 前日扱い
    hour += 24;
  }
  return { weekday, hour, minute, label: `${hour}:${String(minute).padStart(2, "0")}` };
}

/** 人気度（ウォッチャー数）を読みやすく: 12345 -> "1.2万" / 950 -> "950" */
export function formatPopularity(n: number): string {
  if (n >= 10000) return `${(n / 10000).toFixed(1)}万`;
  return n.toLocaleString("ja-JP");
}

/** ISO -> "毎週金曜 23:00〜" のような曜日+時刻 */
export function formatWeekly(iso: string): string {
  const d = new Date(iso);
  const wd = new Intl.DateTimeFormat("ja-JP", { timeZone: TZ, weekday: "short" }).format(d);
  const time = new Intl.DateTimeFormat("ja-JP", {
    timeZone: TZ,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(d);
  return `毎週${wd}曜 ${time}〜`;
}
