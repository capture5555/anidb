/**
 * xAI OAuth ログインヘルパー（ローカルで一度だけ実行する）。
 *   npm run xai-login -- --client-id <CLIENT_ID>
 *   （または環境変数 XAI_OAUTH_CLIENT_ID をセット）
 *
 * 目的:
 *   X Premium+ アカウントの OAuth で xAI の x_search（Live Search）を使うための
 *   リフレッシュトークンを取得する。標準的な OIDC + PKCE（S256）公開クライアントフロー。
 *
 * クライアントID について:
 *   xAI の公開クライアントID は opencode-grok-auth / pi-xai-oauth / Hermes Agent など
 *   オープンソース連携のソースコード内に記載されている（GitHubで確認可能）。
 *   このスクリプトはIDを同梱しない。ユーザーが --client-id か XAI_OAUTH_CLIENT_ID で渡すこと。
 *
 * 流れ:
 *   1. OIDC ディスカバリで authorize/token エンドポイントを取得（失敗時は既知URLにフォールバック）。
 *   2. PKCE verifier/challenge を生成し、127.0.0.1 のローカルコールバックサーバを起動。
 *   3. 認可URLを表示（open/xdg-open を best-effort で起動）してブラウザでログイン。
 *   4. 戻ってきた code を token エンドポイントで交換し、refresh_token を表示する。
 *
 * 出力された refresh_token と client-id を GitHub Secrets に登録すること。
 */
import { createServer } from "node:http";
import { createHash, randomBytes } from "node:crypto";
import { spawn } from "node:child_process";

const OIDC_DISCOVERY = "https://auth.x.ai/.well-known/openid-configuration";
const FALLBACK_AUTHORIZE = "https://auth.x.ai/oauth2/authorize";
const FALLBACK_TOKEN = "https://auth.x.ai/oauth2/token";
const DEFAULT_PORT = 7777;
const DEFAULT_SCOPE = "openid offline_access";

function getArg(name: string): string | undefined {
  const flag = `--${name}`;
  const idx = process.argv.indexOf(flag);
  if (idx !== -1 && process.argv[idx + 1]) return process.argv[idx + 1];
  // --name=value 形式
  const eq = process.argv.find((a) => a.startsWith(`${flag}=`));
  if (eq) return eq.slice(flag.length + 1);
  return undefined;
}

function base64url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function genPkce(): { verifier: string; challenge: string } {
  const verifier = base64url(randomBytes(32));
  const challenge = base64url(createHash("sha256").update(verifier).digest());
  return { verifier, challenge };
}

interface Endpoints {
  authorize: string;
  token: string;
}

async function discoverEndpoints(): Promise<Endpoints> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 8000);
    const res = await fetch(OIDC_DISCOVERY, { signal: ctrl.signal });
    clearTimeout(t);
    if (res.ok) {
      const doc: any = await res.json();
      if (doc?.authorization_endpoint && doc?.token_endpoint) {
        return { authorize: doc.authorization_endpoint, token: doc.token_endpoint };
      }
    }
  } catch {
    /* フォールバックへ */
  }
  console.warn("[xai-login] ディスカバリ取得に失敗。既知のエンドポイントにフォールバックします。");
  return { authorize: FALLBACK_AUTHORIZE, token: FALLBACK_TOKEN };
}

/** OS のブラウザを best-effort で開く（失敗しても無視）。 */
function tryOpen(url: string): void {
  const cmd =
    process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
  try {
    const child = spawn(cmd, [url], { stdio: "ignore", detached: true, shell: process.platform === "win32" });
    child.on("error", () => {});
    child.unref();
  } catch {
    /* 手動で開いてもらう */
  }
}

/** ローカルコールバックサーバを起動し、戻ってきた認可コードを待つ。 */
function waitForCode(port: number): Promise<{ code?: string; error?: string }> {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      const url = new URL(req.url ?? "/", `http://127.0.0.1:${port}`);
      if (url.pathname !== "/callback") {
        res.writeHead(404).end("not found");
        return;
      }
      const code = url.searchParams.get("code") ?? undefined;
      const error = url.searchParams.get("error") ?? undefined;
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(
        `<html><body style="font-family:sans-serif"><h2>${
          code ? "ログイン成功" : "ログイン失敗"
        }</h2><p>このタブを閉じてターミナルに戻ってください。</p></body></html>`,
      );
      server.close();
      resolve({ code, error });
    });
    server.listen(port, "127.0.0.1");
  });
}

async function main() {
  const clientId = getArg("client-id") ?? process.env.XAI_OAUTH_CLIENT_ID;
  if (!clientId) {
    console.error(
      "クライアントIDが必要です。--client-id <ID> か 環境変数 XAI_OAUTH_CLIENT_ID を指定してください。\n" +
        "公開クライアントIDは opencode-grok-auth / pi-xai-oauth 等のOSSソース内に記載があります。",
    );
    process.exit(1);
  }
  const scope = getArg("scope") ?? DEFAULT_SCOPE;
  const port = Number(getArg("port")) || DEFAULT_PORT;
  const redirectUri = `http://127.0.0.1:${port}/callback`;

  const { authorize, token } = await discoverEndpoints();
  const { verifier, challenge } = genPkce();
  const state = base64url(randomBytes(16));

  const authUrl =
    `${authorize}?` +
    new URLSearchParams({
      response_type: "code",
      client_id: clientId,
      redirect_uri: redirectUri,
      scope,
      state,
      code_challenge: challenge,
      code_challenge_method: "S256",
    }).toString();

  console.log("\n=== xAI OAuth ログイン ===");
  console.log(`コールバック: ${redirectUri}`);
  console.log("以下のURLをブラウザで開いてログインしてください（自動で開く場合があります）:\n");
  console.log(authUrl + "\n");

  const codePromise = waitForCode(port);
  tryOpen(authUrl);

  const { code, error } = await codePromise;
  if (error || !code) {
    console.error(`認可に失敗しました: ${error ?? "コードを受け取れませんでした"}`);
    process.exit(1);
  }

  console.log("認可コードを受信。トークンを交換します…");
  let res: Response;
  try {
    res = await fetch(token, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        client_id: clientId,
        redirect_uri: redirectUri,
        code_verifier: verifier,
      }),
    });
  } catch (e) {
    console.error(`トークンエンドポイントへの接続に失敗: ${e}`);
    process.exit(1);
  }

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    console.error(`\nトークン交換に失敗しました: ${res.status}\n${body}`);
    if (res.status === 403) {
      console.error(
        "\n403: x_search はティア制限があります。X Premium+ サブスクリプション（または有料APIキー）が必要です。",
      );
    }
    process.exit(1);
  }

  const json: any = await res.json();
  const accessToken: string = json?.access_token ?? "";
  const refreshToken: string = json?.refresh_token ?? "";
  const expiresIn = json?.expires_in;

  console.log("\n=== 取得結果 ===");
  console.log(
    `access_token: ${accessToken ? accessToken.slice(0, 12) + "…(省略)" : "(なし)"}`,
  );
  console.log(`expires_in:   ${expiresIn ?? "(不明)"} 秒`);
  console.log("\nrefresh_token (全文):");
  console.log(refreshToken || "(なし — offline_access スコープが付与されているか確認してください)");

  console.log("\n--------------------------------------------------------------");
  console.log("GitHub Secrets に XAI_REFRESH_TOKEN / XAI_OAUTH_CLIENT_ID を登録してください。");
  console.log(`  XAI_REFRESH_TOKEN  = 上記の refresh_token`);
  console.log(`  XAI_OAUTH_CLIENT_ID = ${clientId}`);
  console.log("--------------------------------------------------------------\n");

  if (!refreshToken) {
    console.warn(
      "refresh_token が空です。スコープに offline_access が含まれているか、Premium+ 要件を満たしているか確認してください。",
    );
    process.exit(1);
  }
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
