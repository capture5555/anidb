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
