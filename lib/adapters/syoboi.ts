/**
 * しょぼいカレンダー アダプタ（認証不要）。
 * 正確なチャンネル別放送日時を取得する。docs/05 参照。
 *
 * 使用API:
 *  - ProgLookup: TID(作品ID)指定で番組(放送回)一覧。PID/開始終了時刻/話数/チャンネルを含む。
 *  - TitleLookup: 作品情報（タイトル等）。
 *  - ChLookup:    チャンネル一覧。
 */

const DB = "https://cal.syoboi.jp/db.php";
const JSON_API = "https://cal.syoboi.jp/json.php";

export interface SyoboiProgram {
  pid: number; // しょぼいの番組ID（重複防止キー）
  tid: number; // 作品ID
  chId: number; // チャンネルID
  chName: string | null;
  count: number | null; // 話数
  stTime: string; // ISO（開始）
  edTime: string | null; // ISO（終了）
  subTitle: string | null;
}

/** しょぼいの "20260403230000" 形式 → ISO(+09:00) */
function syoboiTimeToISO(s: string | undefined | null): string | null {
  if (!s || s.length < 14) return null;
  const y = s.slice(0, 4);
  const mo = s.slice(4, 6);
  const d = s.slice(6, 8);
  const h = s.slice(8, 10);
  const mi = s.slice(10, 12);
  const se = s.slice(12, 14);
  return `${y}-${mo}-${d}T${h}:${mi}:${se}+09:00`;
}

interface ChannelMap {
  [chId: string]: string;
}

let channelCache: ChannelMap | null = null;

/** チャンネルID→名称 の対応表を取得（キャッシュ） */
export async function fetchChannels(): Promise<ChannelMap> {
  if (channelCache) return channelCache;
  const res = await fetch(`${JSON_API}?Req=ChFilter`);
  const map: ChannelMap = {};
  if (res.ok) {
    const json = await res.json();
    const items = json.ChFilter ?? {};
    for (const key of Object.keys(items)) {
      const ch = items[key];
      if (ch?.ChID) map[String(ch.ChID)] = ch.ChName ?? "";
    }
  }
  channelCache = map;
  return map;
}

/** TID指定で放送回一覧を取得 */
export async function fetchProgramsByTid(tid: number): Promise<SyoboiProgram[]> {
  const channels = await fetchChannels().catch(() => ({} as ChannelMap));
  const res = await fetch(`${DB}?Command=ProgLookup&TID=${tid}`);
  if (!res.ok) throw new Error(`Syoboi ProgLookup failed: ${res.status}`);
  const text = await res.text();
  return parseProgLookupXml(text, channels);
}

/** ProgLookupのXML(<ProgItems><ProgItem>...)を素朴にパース（依存追加なし） */
function parseProgLookupXml(xml: string, channels: ChannelMap): SyoboiProgram[] {
  const programs: SyoboiProgram[] = [];
  const items = xml.match(/<ProgItem[\s\S]*?<\/ProgItem>/g) ?? [];
  const pick = (block: string, tag: string): string | null => {
    const m = block.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`));
    return m ? m[1].trim() : null;
  };
  for (const block of items) {
    const pid = Number(pick(block, "PID"));
    const tid = Number(pick(block, "TID"));
    const chId = Number(pick(block, "ChID"));
    if (!pid || !tid) continue;
    programs.push({
      pid,
      tid,
      chId,
      chName: channels[String(chId)] ?? null,
      count: pick(block, "Count") ? Number(pick(block, "Count")) : null,
      stTime: syoboiTimeToISO(pick(block, "StTime")) ?? "",
      edTime: syoboiTimeToISO(pick(block, "EdTime")),
      subTitle: pick(block, "STSubTitle") || null,
    });
  }
  return programs.filter((p) => p.stTime);
}

/**
 * PID(番組ID)からTID(作品ID)を逆引きする。
 * Annictの Program.scPid（=しょぼいPID）から作品のTIDを特定し、
 * そのTIDで正確な放送回一覧(ProgLookup)を引く、という紐付けに使う。
 */
export async function fetchTidByPid(pid: number): Promise<number | null> {
  const res = await fetch(`${DB}?Command=ProgLookup&PID=${pid}`);
  if (!res.ok) return null;
  const xml = await res.text();
  const m = xml.match(/<TID>(\d+)<\/TID>/);
  return m ? Number(m[1]) : null;
}
