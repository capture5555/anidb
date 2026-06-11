/**
 * xAI (Grok) アダプタ — X(Twitter)上のアニメ「バズ」状況を Live Search で収集する。
 *
 * 認証は2系統:
 *   1. XAI_API_KEY（有料APIキー）があればそれをそのまま使う。
 *   2. なければ XAI_REFRESH_TOKEN + XAI_OAUTH_CLIENT_ID（X Premium+ の OAuth ログイン）で
 *      アクセストークンを都度発行する。x_search はサブスクのクォータで利用できる。
 *      ※ リフレッシュトークンは `npm run xai-login` をローカルで実行して取得し、
 *        GitHub Secrets に登録しておく（scripts/xai-login.ts 参照）。
 *
 * ★ xAI のレスポンス形は公式仕様が流動的で確定していない（Live Search / search_parameters の
 *   フィールド名・citations の有無・content の構造などが変わりうる）。そのため本アダプタは:
 *     - プロンプトでモデルに「JSONのみで返答」させる
 *     - 返ってきた本文をコードフェンス除去＋最初の {...} 抽出で頑健にパースする
 *     - いかなる失敗（ネットワーク/認証/JSON崩れ/ティア制限）も throw せず null を返す
 *   ことで、呼び出し側（cron）が落ちないようにしている。
 */

const API_BASE = "https://api.x.ai/v1";
const OIDC_DISCOVERY = "https://auth.x.ai/.well-known/openid-configuration";
// ディスカバリ取得に失敗したときのフォールバック（BACKGROUND の検証済みURL）。
const FALLBACK_TOKEN_ENDPOINT = "https://auth.x.ai/oauth2/token";

const MODEL = process.env.XAI_MODEL || "grok-4";

export interface XBuzzResult {
  /** 0=ほぼ無し 〜 5=トレンド級 のざっくり投稿量スコア */
  post_volume_estimate: number;
  /** 話題になっている点（短いキーワード/フレーズ） */
  notable_topics: string[];
  /** 全体的な感情 */
  sentiment: "positive" | "mixed" | "negative";
  /** 代表的な投稿の引用（要約・改変されうる） */
  sample_quotes: string[];
}

/** XAI（APIキー or OAuth）が設定済みかどうか。cron はこれで早期スキップを判断する。 */
export function isXaiConfigured(): boolean {
  if (process.env.XAI_API_KEY) return true;
  return Boolean(process.env.XAI_REFRESH_TOKEN && process.env.XAI_OAUTH_CLIENT_ID);
}

// ---- トークンエンドポイントのディスカバリ（モジュール内キャッシュ） ----
let cachedTokenEndpoint: string | null = null;

async function getTokenEndpoint(): Promise<string> {
  if (cachedTokenEndpoint) return cachedTokenEndpoint;
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 8000);
    const res = await fetch(OIDC_DISCOVERY, { signal: ctrl.signal });
    clearTimeout(t);
    if (res.ok) {
      const doc: any = await res.json();
      if (doc?.token_endpoint && typeof doc.token_endpoint === "string") {
        const endpoint: string = doc.token_endpoint;
        cachedTokenEndpoint = endpoint;
        return endpoint;
      }
    }
  } catch {
    /* フォールバックへ */
  }
  cachedTokenEndpoint = FALLBACK_TOKEN_ENDPOINT;
  return cachedTokenEndpoint;
}

// ---- アクセストークンのキャッシュ（モジュールメモリ。期限60秒前まで再利用） ----
let cachedAccessToken: string | null = null;
let cachedTokenExpiry = 0; // epoch ms
let refreshFailedOnce = false;

/**
 * 利用可能なアクセストークンを返す。取得不能なら null（ログは一度だけ）。
 * - XAI_API_KEY があればそれを返す（リフレッシュ不要）。
 * - そうでなければ refresh_token グラントでアクセストークンを発行しキャッシュする。
 */
export async function getAccessToken(): Promise<string | null> {
  const apiKey = process.env.XAI_API_KEY;
  if (apiKey) return apiKey;

  const refreshToken = process.env.XAI_REFRESH_TOKEN;
  const clientId = process.env.XAI_OAUTH_CLIENT_ID;
  if (!refreshToken || !clientId) return null;

  // 期限の60秒前まではキャッシュを使う
  if (cachedAccessToken && Date.now() < cachedTokenExpiry - 60_000) {
    return cachedAccessToken;
  }
  if (refreshFailedOnce) return null; // 既に失敗していれば毎回叩かない

  try {
    const tokenEndpoint = await getTokenEndpoint();
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 8000);
    const res = await fetch(tokenEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
        client_id: clientId,
      }),
      signal: ctrl.signal,
    });
    clearTimeout(t);

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.warn(
        `[xai] トークン更新に失敗: ${res.status} ${body.slice(0, 300)}` +
          (res.status === 403
            ? "（x_search は X Premium+ サブスクまたは有料APIキーが必要です）"
            : ""),
      );
      refreshFailedOnce = true;
      return null;
    }

    const json: any = await res.json();
    const accessToken: string | undefined = json?.access_token;
    const expiresIn: number = Number(json?.expires_in) || 3600;
    if (!accessToken) {
      console.warn("[xai] トークン更新レスポンスに access_token がありません");
      refreshFailedOnce = true;
      return null;
    }

    // リフレッシュトークンがローテーションされた場合、CI上では永続化できないため警告のみ。
    if (json?.refresh_token && json.refresh_token !== refreshToken) {
      console.warn(
        "[xai] 新しい refresh_token が発行されました。GitHub Secrets の XAI_REFRESH_TOKEN を更新してください。",
      );
    }

    cachedAccessToken = accessToken;
    cachedTokenExpiry = Date.now() + expiresIn * 1000;
    return cachedAccessToken;
  } catch (e) {
    console.warn(`[xai] トークン更新で例外: ${e}`);
    refreshFailedOnce = true;
    return null;
  }
}

/** コードフェンスを剥がし、最初の {...} を抜き出して JSON.parse する頑健パーサ。 */
function parseJsonLoose(text: string): unknown | null {
  if (!text) return null;
  let s = text.trim();
  // ```json ... ``` / ``` ... ``` を除去
  s = s.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/i, "");
  // 最初の { から対応する最後の } までを抜き出す（前後の地の文を無視）
  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    // それでもダメなら全体を試す
    try {
      return JSON.parse(s);
    } catch {
      return null;
    }
  }
  const candidate = s.slice(start, end + 1);
  try {
    return JSON.parse(candidate);
  } catch {
    return null;
  }
}

/** 任意のパース結果を XBuzzResult に正規化（型を担保。崩れていたら null）。 */
function normalizeResult(raw: unknown): XBuzzResult | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;

  let volume = Number(o.post_volume_estimate);
  if (!Number.isFinite(volume)) return null;
  volume = Math.max(0, Math.min(5, Math.round(volume)));

  const sentimentRaw = String(o.sentiment ?? "mixed").toLowerCase();
  const sentiment: XBuzzResult["sentiment"] =
    sentimentRaw === "positive" || sentimentRaw === "negative" ? sentimentRaw : "mixed";

  const toStringArray = (v: unknown): string[] =>
    Array.isArray(v) ? v.map((x) => String(x)).filter((s) => s.length > 0).slice(0, 20) : [];

  return {
    post_volume_estimate: volume,
    notable_topics: toStringArray(o.notable_topics),
    sentiment,
    sample_quotes: toStringArray(o.sample_quotes),
  };
}

interface ChatOptions {
  fromDate: string; // YYYY-MM-DD
  toDate: string; // YYYY-MM-DD
}

/** chat/completions を search_parameters 付きで1回叩く（タイムアウト8秒）。失敗時は null。 */
async function callChat(
  token: string,
  prompt: string,
  opts: ChatOptions,
): Promise<string | null> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 8000);
  try {
    const res = await fetch(`${API_BASE}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [{ role: "user", content: prompt }],
        // xAI Live Search 形式。フィールド名は流動的なので、未対応でも無害なものに留める。
        search_parameters: {
          mode: "on",
          sources: [{ type: "x" }],
          from_date: opts.fromDate,
          to_date: opts.toDate,
          max_search_results: 20,
        },
        temperature: 0,
      }),
      signal: ctrl.signal,
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.warn(`[xai] chat/completions 失敗: ${res.status} ${body.slice(0, 300)}`);
      return null;
    }
    const json: any = await res.json();
    // OpenAI互換: choices[0].message.content。content が配列のことも考慮。
    const content = json?.choices?.[0]?.message?.content;
    if (typeof content === "string") return content;
    if (Array.isArray(content)) {
      return content
        .map((c: any) => (typeof c === "string" ? c : c?.text ?? ""))
        .join("");
    }
    return null;
  } catch (e) {
    console.warn(`[xai] chat/completions で例外: ${e}`);
    return null;
  } finally {
    clearTimeout(t);
  }
}

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * 指定作品の直近 hours 時間における X 上のバズ状況を取得する。
 * 失敗（未設定/認証/ネットワーク/JSON崩れ）はすべて null（throw しない）。1回リトライ。
 */
export async function searchAnimeBuzz(
  workTitle: string,
  hashtags: string[],
  hours: number,
): Promise<XBuzzResult | null> {
  const token = await getAccessToken();
  if (!token) return null;

  const now = new Date();
  const from = new Date(now.getTime() - hours * 3600 * 1000);
  const opts: ChatOptions = { fromDate: ymd(from), toDate: ymd(now) };

  const tagStr = hashtags.length > 0 ? hashtags.join(", ") : "（指定なし）";
  const prompt =
    `次のアニメ作品についての直近${hours}時間のX上の投稿状況を検索し、JSONのみで返答してください。\n` +
    `余計な説明やコードフェンスは付けず、次の形のオブジェクトだけを出力してください:\n` +
    `{"post_volume_estimate": number(0-5の整数: 0=ほぼ無し,5=トレンド級), ` +
    `"notable_topics": string[], "sentiment": "positive"|"mixed"|"negative", "sample_quotes": string[]}\n` +
    `作品名: ${workTitle}\n` +
    `関連ハッシュタグ: ${tagStr}`;

  for (let attempt = 0; attempt < 2; attempt++) {
    const content = await callChat(token, prompt, opts);
    if (content) {
      const result = normalizeResult(parseJsonLoose(content));
      if (result) return result;
    }
    // 1回だけリトライ（一時的な失敗/JSON崩れに備える）
  }
  return null;
}
