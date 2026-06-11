/**
 * X(Twitter) の生ポスト抽出ユーティリティ（純粋関数・テスト可能）。
 *
 * x_search(Hermes/Grok) は「実際のポスト(URL)」のサンプルを返す。ここでは:
 *   - tweet の status id から Snowflake で各ポストの実時刻を復元し(snowflakeToDate)、
 *   - status URL から id を取り出し(extractStatusId)、
 *   - 回答 markdown と citations の双方からポスト候補を集約する(parsePostsFromAnswer)。
 * これらを多数ランで蓄積すると、生 API 無しで X の実エンゲージメント時系列が作れる。
 *
 * すべて throw しない/防御的（壊れた入力は黙って捨てる）方針。
 */

/** Twitter(X) の Snowflake epoch（2010-11-04T01:42:54.657Z, ms）。 */
const TWITTER_EPOCH_MS = 1288834974657n;

/** 妥当な posted_at の下限（これより前は復元ミスとみなす）。 */
const MIN_VALID_MS = Date.UTC(2015, 0, 1); // 2015-01-01T00:00:00Z

/**
 * tweet の status id を Snowflake デコードして投稿時刻(Date)を返す。
 *   ms = (BigInt(id) >> 22n) + TWITTER_EPOCH_MS
 * 数字以外を含む / 復元結果が [2015-01-01, now+1day] の範囲外なら null。
 */
export function snowflakeToDate(statusId: string): Date | null {
  if (typeof statusId !== "string" || !/^\d+$/.test(statusId)) return null;
  let ms: bigint;
  try {
    ms = (BigInt(statusId) >> 22n) + TWITTER_EPOCH_MS;
  } catch {
    return null;
  }
  // Number 化（ms は安全整数の範囲に十分収まる）。
  const msNum = Number(ms);
  if (!Number.isFinite(msNum)) return null;
  const maxValidMs = Date.now() + 24 * 60 * 60 * 1000; // now + 1 day
  if (msNum < MIN_VALID_MS || msNum > maxValidMs) return null;
  const d = new Date(msNum);
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

/** status URL から tweet id(数字列)を取り出す。マッチしなければ null。 */
const STATUS_URL_RE =
  /https?:\/\/(?:x|twitter|mobile\.twitter|vxtwitter|fxtwitter)\.com\/[^/\s"'<>)]+\/status(?:es)?\/(\d+)/i;

export function extractStatusId(url: string): string | null {
  if (typeof url !== "string" || url.length === 0) return null;
  const m = url.match(STATUS_URL_RE);
  return m ? m[1] : null;
}

/** parsePostsFromAnswer が返す1ポスト。 */
export interface ParsedPost {
  url: string;
  statusId: string;
  text: string | null;
  /** ISO 文字列（Snowflake から復元した実時刻）。 */
  postedAt: string;
}

/** POSTS_JSON ブロックの1要素として期待する形（緩く扱う）。 */
interface PostsJsonItem {
  url?: unknown;
  text?: unknown;
}

/**
 * `answer` 末尾の `POSTS_JSON:` 以降、最初のバランスした [...] を切り出して JSON.parse する。
 * 失敗(マーカ無し/壊れ JSON)は [] を返す（throw しない）。
 */
function extractPostsJson(answer: string): PostsJsonItem[] {
  if (!answer) return [];
  const marker = answer.indexOf("POSTS_JSON:");
  if (marker === -1) return [];
  const rest = answer.slice(marker + "POSTS_JSON:".length);
  const open = rest.indexOf("[");
  if (open === -1) return [];

  let depth = 0;
  let end = -1;
  let inString = false;
  let escaped = false;
  for (let i = open; i < rest.length; i++) {
    const ch = rest[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (inString) {
      if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "[") depth++;
    else if (ch === "]") {
      depth--;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  if (end === -1) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(rest.slice(open, end + 1));
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  return parsed.filter((x): x is PostsJsonItem => x != null && typeof x === "object");
}

/** answer markdown 内の全 status URL を素朴に列挙する（重複は後段で除去）。 */
function findStatusUrlsInText(text: string): string[] {
  if (!text) return [];
  const re = new RegExp(STATUS_URL_RE.source, "gi");
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    out.push(m[0]);
  }
  return out;
}

/** 抽出上限（蓄積はランをまたぐので1ランの取り込みは控えめに上限）。 */
const POSTS_CAP = 60;

/**
 * 回答(answer markdown)と citations から実際のポストを抽出する。
 *  (a) 末尾 `POSTS_JSON:` ブロック（url/text 付き）
 *  (b) answer 内のあらゆる status URL（markdown リンク含む）
 *  (c) citations の url
 * それぞれ extractStatusId + snowflakeToDate を通し、失敗は捨てる。
 * statusId で重複排除（text を持つ候補を優先）。最大 POSTS_CAP 件。
 */
export function parsePostsFromAnswer(
  answer: string,
  citations: { url: string }[],
): ParsedPost[] {
  const byId = new Map<string, ParsedPost>();

  const consider = (rawUrl: unknown, rawText: unknown): void => {
    if (typeof rawUrl !== "string" || rawUrl.length === 0) return;
    const statusId = extractStatusId(rawUrl);
    if (!statusId) return;
    const date = snowflakeToDate(statusId);
    if (!date) return;
    const text =
      typeof rawText === "string" && rawText.trim().length > 0
        ? rawText.trim().slice(0, 500)
        : null;
    const existing = byId.get(statusId);
    if (existing) {
      // text を持つ候補を優先。既存に text が無く新候補にあれば上書き。
      if (!existing.text && text) {
        existing.text = text;
        existing.url = rawUrl;
      }
      return;
    }
    byId.set(statusId, {
      url: rawUrl,
      statusId,
      text,
      postedAt: date.toISOString(),
    });
  };

  // (a) POSTS_JSON ブロック（url/text 付きを最優先で取り込む）。
  for (const item of extractPostsJson(answer ?? "")) {
    consider(item.url, item.text);
  }

  // (b) answer 内の status URL。
  for (const url of findStatusUrlsInText(answer ?? "")) {
    consider(url, null);
  }

  // (c) citations の url。
  if (Array.isArray(citations)) {
    for (const c of citations) {
      const url = c && typeof c === "object" ? (c as { url?: unknown }).url : undefined;
      consider(url, null);
    }
  }

  return [...byId.values()].slice(0, POSTS_CAP);
}
