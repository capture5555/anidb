/**
 * Hermes (NousResearch hermes-agent / xAI 公認) アダプタ — Hermes モードの X バズ収集。
 *
 * 通常の Grok API キー/OAuth(lib/adapters/xai.ts)とは別経路で、ローカルに認証済みの
 * hermes-agent パッケージの内部ツール `x_search_tool` を `uvx` 経由で呼び出す。
 *
 *   1回限りのローカル認証:
 *     uvx --from hermes-agent hermes auth add xai-oauth   （資格情報は ~/.hermes に保存）
 *   本アダプタの実体:
 *     uvx --from hermes-agent python scripts/x_search_query.py "<query>"
 *   （Hermes エージェントループを介さず x_search_tool を直接呼ぶ。1クエリ 30 秒以上かかる。）
 *
 * x_search_tool が返す JSON 例:
 *   {"success": true, "provider":"xai", "tool":"x_search", "model":"grok-4.20-reasoning",
 *    "query":"...", "answer":"<[[n]](url) 付き markdown>", "citations":[],
 *    "inline_citations":[{"url":...,...}]}
 *
 * これは「X 検索そのもの」ではなく Grok による X の分析結果である点に注意。投稿量(volume)は
 * 体感の推定値にすぎない。課金は X Premium の OAuth サブスククォータ（従量課金なし）。
 *
 * 失敗（uvx 不在/認証なし/タイムアウト/JSON 崩れ）はすべて throw せず null を返し、
 * 呼び出し側(cron)が落ちないようにする。ログは1ラン1回に抑える。
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface HermesXResult {
  /** Grok による X 反応の要約（[[n]](url) 形式の引用付き markdown） */
  answer: string;
  /** 利用モデル名（取得できなければ null） */
  model: string | null;
  /** インライン引用から抽出・重複排除した URL 群 */
  citations: { url: string }[];
}

/**
 * Hermes モードが利用可能かどうか。
 * - env HERMES_X_ENABLED が truthy（ワークフローがシークレット存在時に立てる）、または
 * - ~/.hermes が存在する（ローカルで認証済み）。
 */
export function isHermesConfigured(): boolean {
  const flag = process.env.HERMES_X_ENABLED;
  if (flag && flag !== "0" && flag.toLowerCase() !== "false") return true;
  try {
    return existsSync(join(homedir(), ".hermes"));
  } catch {
    return false;
  }
}

// 失敗ログを1ランにつき1回だけに抑えるためのフラグ。
let loggedFailureOnce = false;
function logFailureOnce(msg: string): void {
  if (loggedFailureOnce) return;
  loggedFailureOnce = true;
  console.warn(`[hermesX] ${msg}`);
}

/** stdout から最後の {...} JSON オブジェクトを頑健に抽出して parse する。 */
function parseLastJsonObject(text: string): unknown | null {
  if (!text) return null;
  const end = text.lastIndexOf("}");
  if (end === -1) return null;
  // end に対応する開き括弧を、深さを数えながら後ろから探す。
  let depth = 0;
  let start = -1;
  let inString = false;
  let escaped = false;
  for (let i = end; i >= 0; i--) {
    const ch = text[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (inString) {
      if (ch === "\\") {
        // 直前のバックスラッシュをエスケープとして扱う（後ろ向き走査の近似）。
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
    } else if (ch === "}") {
      depth++;
    } else if (ch === "{") {
      depth--;
      if (depth === 0) {
        start = i;
        break;
      }
    }
  }
  if (start === -1) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}

/**
 * uvx 経由で x_search_tool を呼び、結果を HermesXResult に正規化する。
 * 失敗時は null（throw しない）。timeoutMs 超過でプロセスを kill。
 */
export function hermesXSearch(
  query: string,
  timeoutMs = 120000,
): Promise<HermesXResult | null> {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(
        "uvx",
        ["--from", "hermes-agent", "python", "scripts/x_search_query.py", query],
        { stdio: ["ignore", "pipe", "pipe"] },
      );
    } catch (e) {
      logFailureOnce(`uvx の起動に失敗: ${e}`);
      resolve(null);
      return;
    }

    let stdout = "";
    let stderr = "";
    let settled = false;

    const finish = (value: HermesXResult | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    };

    const timer = setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch {
        /* noop */
      }
      logFailureOnce(`タイムアウト(${timeoutMs}ms)で kill しました`);
      finish(null);
    }, timeoutMs);

    child.stdout?.on("data", (d) => {
      stdout += String(d);
    });
    child.stderr?.on("data", (d) => {
      stderr += String(d);
    });

    child.on("error", (e) => {
      logFailureOnce(`uvx 実行エラー(uvx 未インストール?): ${e.message}`);
      finish(null);
    });

    child.on("close", () => {
      const parsed = parseLastJsonObject(stdout);
      if (!parsed || typeof parsed !== "object") {
        logFailureOnce(
          `JSON を解釈できませんでした。stderr=${stderr.slice(0, 300)}`,
        );
        finish(null);
        return;
      }
      const o = parsed as Record<string, unknown>;
      if (o.success === false) {
        logFailureOnce(`x_search_tool が失敗を返しました: ${String(o.error)}`);
        finish(null);
        return;
      }
      const answer = typeof o.answer === "string" ? o.answer : "";
      if (!answer) {
        logFailureOnce("answer が空でした");
        finish(null);
        return;
      }
      const model = typeof o.model === "string" ? o.model : null;

      // inline_citations から URL を抽出し重複排除。
      const seen = new Set<string>();
      const citations: { url: string }[] = [];
      const inline = o.inline_citations;
      if (Array.isArray(inline)) {
        for (const c of inline) {
          const url =
            c && typeof c === "object"
              ? (c as Record<string, unknown>).url
              : undefined;
          if (typeof url === "string" && url.length > 0 && !seen.has(url)) {
            seen.add(url);
            citations.push({ url });
          }
        }
      }

      finish({ answer, model, citations });
    });
  });
}

/**
 * Grok の回答テキストから保存用フィールドを導出する純粋関数（テスト可能）。
 *
 * クエリ側で「回答の末尾に必ず 1 行 `BUZZ_JSON: {...}` を出力せよ」と指示しておき、
 * ここでは `BUZZ_JSON:` 以降の最初の {...} を取り出して JSON.parse する。
 * 取れない/壊れている場合は安全側にフォールバック:
 *   volume_score = clamp(round(citationCount / 2), 0, 5), sentiment=null, topics=[], quotes=[]
 *
 * @param workTitle 作品名（フォールバック/将来拡張用。現状は未使用だがシグネチャを保つ）
 * @param answer    x_search_tool の answer（markdown）
 * @param citationCount inline 引用の件数（フォールバック時の volume 推定に使う）
 */
export function buzzFromAnswer(
  workTitle: string,
  answer: string,
  citationCount: number,
): { volume_score: number; sentiment: string | null; topics: string[]; quotes: string[] } {
  const clamp05 = (n: number) => Math.max(0, Math.min(5, n));
  const fallback = () => ({
    volume_score: clamp05(Math.round(citationCount / 2)),
    sentiment: null,
    topics: [] as string[],
    quotes: [] as string[],
  });

  if (!answer) return fallback();

  const marker = answer.indexOf("BUZZ_JSON:");
  if (marker === -1) return fallback();

  // marker 以降の最初の {...} を深さカウントで切り出す。
  const rest = answer.slice(marker + "BUZZ_JSON:".length);
  const open = rest.indexOf("{");
  if (open === -1) return fallback();

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
    else if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  if (end === -1) return fallback();

  let parsed: unknown;
  try {
    parsed = JSON.parse(rest.slice(open, end + 1));
  } catch {
    return fallback();
  }
  if (!parsed || typeof parsed !== "object") return fallback();
  const o = parsed as Record<string, unknown>;

  // volume: 0..5 の整数。取れなければ引用数フォールバック。
  let volume = Number(o.volume);
  if (!Number.isFinite(volume)) volume = Math.round(citationCount / 2);
  const volume_score = clamp05(Math.round(volume));

  // sentiment: 既知の3値のみ採用。それ以外は null。
  const sentRaw = typeof o.sentiment === "string" ? o.sentiment.toLowerCase() : "";
  const sentiment =
    sentRaw === "positive" || sentRaw === "mixed" || sentRaw === "negative"
      ? sentRaw
      : null;

  const toStringArray = (v: unknown): string[] =>
    Array.isArray(v)
      ? v.map((x) => String(x)).filter((s) => s.length > 0).slice(0, 20)
      : [];

  return {
    volume_score,
    sentiment,
    topics: toStringArray(o.topics),
    quotes: toStringArray(o.quotes),
  };
}
