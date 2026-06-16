/**
 * ICS（iCalendar / RFC 5545）の手書きシリアライザ。依存ライブラリなし。
 * - TEXT値のエスケープ（\ ; , 改行）
 * - 1行75オクテットの折返し（マルチバイト文字を壊さないようコードポイント単位で詰める）
 * - 行末はCRLF
 * 時刻はUTCのZ表記で出力する（日本はDSTが無いため VTIMEZONE 定義は不要）。
 */

const CRLF = "\r\n";
const encoder = new TextEncoder();

export interface IcsEvent {
  /** 安定UID。同じ予定は毎回同じUIDで出すことで、Google側の更新・削除が正しく動く */
  uid: string;
  startISO: string;
  endISO: string;
  summary: string;
  description?: string;
  /** 場所（LOCATION）。放送局名を入れる */
  location?: string;
  /**
   * 終日イベントの日付（JST暦日 "YYYY-MM-DD"）。映画の公開日など時刻を持たない予定に使う。
   * 指定時は DTSTART/DTEND を VALUE=DATE で出力する（startISO は並び替え用に保持）。
   */
  allDayDate?: string;
}

export interface IcsCalendarOptions {
  /** カレンダー名（X-WR-CALNAME） */
  name: string;
  /** 購読クライアントへ提示する再取得間隔（時間）。既定6時間 */
  refreshIntervalHours?: number;
}

function escapeText(s: string): string {
  return s
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

/** ISO8601 → ICSのUTC表記（YYYYMMDDTHHMMSSZ） */
function toUtcStamp(iso: string): string {
  return new Date(iso).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

/** "YYYY-MM-DD" → ICSのDATE表記（YYYYMMDD） */
function toDateStamp(ymd: string): string {
  return ymd.replace(/-/g, "");
}

/** 終日イベントのDTEND用に翌日のDATE表記を返す（DTENDは排他的なため+1日） */
function nextDateStamp(ymd: string): string {
  const dt = new Date(`${ymd}T00:00:00Z`);
  dt.setUTCDate(dt.getUTCDate() + 1);
  return dt.toISOString().slice(0, 10).replace(/-/g, "");
}

/** 75オクテット折返し。継続行は先頭にスペース1つ（スペースも75オクテットに含む） */
function foldLine(line: string): string[] {
  if (encoder.encode(line).length <= 75) return [line];
  const out: string[] = [];
  let cur = "";
  let curBytes = 0;
  for (const ch of line) {
    const b = encoder.encode(ch).length;
    if (curBytes + b > 75) {
      out.push(cur);
      cur = " ";
      curBytes = 1;
    }
    cur += ch;
    curBytes += b;
  }
  out.push(cur);
  return out;
}

export function buildIcs(events: IcsEvent[], opts: IcsCalendarOptions): string {
  const lines: string[] = [];
  const push = (l: string) => lines.push(...foldLine(l));

  const refresh = `PT${opts.refreshIntervalHours ?? 6}H`;
  push("BEGIN:VCALENDAR");
  push("VERSION:2.0");
  push("PRODID:-//anidb//anime-calendar//JA");
  push("CALSCALE:GREGORIAN");
  push("METHOD:PUBLISH");
  push(`X-WR-CALNAME:${escapeText(opts.name)}`);
  push("X-WR-TIMEZONE:Asia/Tokyo");
  push(`REFRESH-INTERVAL;VALUE=DURATION:${refresh}`);
  push(`X-PUBLISHED-TTL:${refresh}`);

  // DTSTAMP は「このフィードを生成した時刻」。ここ以外は同一データなら毎回同じ出力になる
  const dtstamp = toUtcStamp(new Date().toISOString());

  for (const ev of events) {
    push("BEGIN:VEVENT");
    push(`UID:${ev.uid}`);
    push(`DTSTAMP:${dtstamp}`);
    if (ev.allDayDate) {
      // 終日イベント（映画の公開日など）。DTENDは排他的なので翌日を入れる。
      push(`DTSTART;VALUE=DATE:${toDateStamp(ev.allDayDate)}`);
      push(`DTEND;VALUE=DATE:${nextDateStamp(ev.allDayDate)}`);
    } else {
      push(`DTSTART:${toUtcStamp(ev.startISO)}`);
      push(`DTEND:${toUtcStamp(ev.endISO)}`);
    }
    push(`SUMMARY:${escapeText(ev.summary)}`);
    if (ev.location) push(`LOCATION:${escapeText(ev.location)}`);
    if (ev.description) push(`DESCRIPTION:${escapeText(ev.description)}`);
    push("END:VEVENT");
  }
  push("END:VCALENDAR");
  return lines.join(CRLF) + CRLF;
}
