/**
 * リアクション辞書（lib/analytics/commentAnalysis.ts）を改良したとき、
 * 保存済みの生ログ（analytics_jikkyo_comments）から heat / reactions / peak_comments を
 * 全番組分再計算するCLI。生ログを保存している最大の価値。
 *   npm run reanalyze-comments
 * 必要env: NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY
 */
import { readFileSync } from "node:fs";

// .env.local を手動ロード（単体nodeスクリプトはNext.jsと違い自動で読まないため）
try {
  const env = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
  for (const line of env.split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
} catch {
  /* 環境変数があれば動く */
}

import { getAdminClient } from "../lib/supabase/admin.ts";
import { analyzeProgram } from "../lib/analytics/commentAnalysis.ts";
import { storeProgramAnalysis } from "../lib/sync/collectJikkyo.ts";
import type { JikkyoComment } from "../lib/adapters/jikkyo.ts";

const PAGE = 1000;

/** 生ログを持つ program_id を全件集める（重複除去はクライアント側） */
async function listProgramIds(db: ReturnType<typeof getAdminClient>): Promise<string[]> {
  const ids = new Set<string>();
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await db
      .from("analytics_jikkyo_comments")
      .select("program_id")
      .order("program_id")
      .range(offset, offset + PAGE - 1);
    if (error) throw error;
    for (const row of data ?? []) ids.add(row.program_id);
    if ((data ?? []).length < PAGE) break;
  }
  return [...ids];
}

async function loadComments(
  db: ReturnType<typeof getAdminClient>,
  programId: string,
): Promise<JikkyoComment[]> {
  const comments: JikkyoComment[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await db
      .from("analytics_jikkyo_comments")
      .select("posted_at, content")
      .eq("program_id", programId)
      .order("posted_at")
      .range(offset, offset + PAGE - 1);
    if (error) throw error;
    for (const row of data ?? []) {
      comments.push({
        date: Math.floor(new Date(row.posted_at).getTime() / 1000),
        content: row.content,
      });
    }
    if ((data ?? []).length < PAGE) break;
  }
  return comments;
}

async function main() {
  const db = getAdminClient();
  const programIds = await listProgramIds(db);
  console.log(`再分析対象: ${programIds.length} 番組`);

  let done = 0;
  for (const programId of programIds) {
    const { data: prog } = await db
      .from("programs")
      .select("start_at")
      .eq("id", programId)
      .maybeSingle();
    if (!prog) continue;

    const comments = await loadComments(db, programId);
    const startUnix = Math.floor(new Date(prog.start_at).getTime() / 1000);
    const analysis = analyzeProgram(comments, startUnix);
    await storeProgramAnalysis(db, programId, analysis);
    done++;
    if (done % 25 === 0) console.log(`  ${done}/${programIds.length}`);
  }
  console.log(`done: ${done} 番組を再計算しました`);
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
