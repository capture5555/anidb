/**
 * しょぼいカレンダー アダプタ（認証不要）。
 *
 * 役割（2026-06-05〜）: **サブタイトルの補完**。
 * 放送日時・放送局・話数は Annict 単体で取得できるため、しょぼいは
 * 「Annictにサブタイトルが無い回を埋める」補完ソースとして使う。
 *
 * 使用API:
 *  - json.php?Req=TitleSearch&Search=... : タイトル検索 → TID取得
 *  - json.php?Req=TitleFull&TID=...      : 作品情報（SubTitles文字列を含む）
 */

const JSON_API = "https://cal.syoboi.jp/json.php";

function norm(s: string): string {
  return s.replace(/\s+/g, "").normalize("NFKC").toLowerCase();
}

interface SyoboiTitle {
  TID: string;
  Title: string;
  FirstYear?: string;
  FirstMonth?: string;
}

/**
 * Annictのタイトル（＋放送年）から しょぼいの TID を推定する。
 * 誤マッチを避けるため、完全一致 or（年一致かつ部分一致）のみ採用。見つからなければ null。
 */
export async function findTid(title: string, year?: number | null): Promise<number | null> {
  const url = `${JSON_API}?Req=TitleSearch&Search=${encodeURIComponent(title)}`;
  const res = await fetch(url);
  if (!res.ok) return null;
  const json = await res.json().catch(() => null);
  const titles: SyoboiTitle[] = json?.Titles ? Object.values(json.Titles) : [];
  if (titles.length === 0) return null;

  const nt = norm(title);
  // 1) 完全一致
  const exact = titles.find((t) => norm(t.Title) === nt);
  if (exact) return Number(exact.TID);

  // 2) 年が一致し、かつ部分一致（どちらかが他方を含む）
  if (year) {
    const cand = titles.find((t) => {
      if (Number(t.FirstYear) !== year) return false;
      const ntt = norm(t.Title);
      return ntt.includes(nt) || nt.includes(ntt);
    });
    if (cand) return Number(cand.TID);
  }

  return null;
}

/**
 * TIDから「話数 → サブタイトル」の対応表を取得する。
 * しょぼいの SubTitles フィールドは `*1*サブタイトル` 形式（空のこともある）。
 */
export async function fetchSubtitles(tid: number): Promise<Map<number, string>> {
  const map = new Map<number, string>();
  const res = await fetch(`${JSON_API}?Req=TitleFull&TID=${tid}`);
  if (!res.ok) return map;
  const json = await res.json().catch(() => null);
  const raw: string = json?.Titles?.[String(tid)]?.SubTitles ?? "";
  if (!raw) return map;

  const re = /\*(\d+)\*([^\r\n]*)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw)) !== null) {
    const num = Number(m[1]);
    const text = m[2].trim();
    if (text) map.set(num, text);
  }
  return map;
}

/**
 * Annictタイトルから、サブタイトル補完用の「話数→サブタイトル」表を取得（TID検索込み）。
 * 見つからなければ空のMap。
 */
export async function fetchSubtitlesByTitle(
  title: string,
  year?: number | null,
): Promise<Map<number, string>> {
  const tid = await findTid(title, year);
  if (!tid) return new Map();
  return fetchSubtitles(tid);
}
