/**
 * IP・続編のシーズン越えモメンタム分析。
 *
 * 課題: works には title / season_year / season_name / popularity / score しかなく、
 * 「どの作品が同じIP（フランチャイズ）の続編か」を示す明示的な関係テーブルが存在しない。
 * そこで TITLE STEM（語幹）マッチングという純粋・テスト可能なヒューリスティクスで
 * フランチャイズを近似的にグルーピングする。
 *
 * これは「公式のシリーズ情報」ではなく、同名タイトルの語幹一致による近似である点に注意。
 * 続編greenlight・フランチャイズ投資の意思決定材料（IPが伸びているか/縮小しているか）として使う。
 */

import { getAdminClient } from "../supabase/admin.ts";
import { memoizeTTL } from "../cache.ts";
import { fromSnapshotOrLive } from "./snapshots.ts";

/* ================================================================
   純関数（単体テスト可能・DB不要）
   ================================================================ */

/** クール（season_name）の暦順ランク。winter < spring < summer < autumn。 */
const SEASON_RANK: Record<string, number> = {
  winter: 0,
  spring: 1,
  summer: 2,
  autumn: 3,
};

/**
 * フランチャイズの「語幹（stem）」を求める純関数。
 *
 * タイトルから続編マーカーを剥がし、シリーズの基底名を返す。
 * 戦略は保守的（=取りこぼしより誤結合を避ける）であり、以下を順に剥がす:
 *   1. NFKC 正規化 + lowercase + trim（全角/半角・大文字小文字の揺れを吸収）
 *   2. 「：」「:」以降の副題を、基底前置部分が4文字以上なら落とす
 *      （例「物語：第二章」→「物語」）。短すぎる前置は落とさない（誤爆防止）。
 *   3. 末尾のシーズンマーカー:
 *      - 第?[2-9０-９二三四五六七八九]+(期|シーズン|クール)（例「2期」「第3シーズン」）
 *      - season N / Nnd|rd|th season（例「season 2」「2nd season」）
 *      - ローマ数字 II/III/IV と全角 Ⅱ/Ⅲ/Ⅳ（末尾のみ）
 *      - part N / cour 系（後編・前編・完結編・part 2）
 *   4. 末尾の区切り記号・空白（半角/全角スペース・中黒・ハイフン等）と残った数字を整理
 *
 * 限界・既知の弱点（重要）:
 *   - 副題でブランドが変わるIP（例「Fate/stay night」vs「Fate/Zero」）は誤結合し得る。
 *     「/」では分割しないため通常は別物として残るが、「：」副題は基底一致時のみ落とす。
 *   - 「無印」と「2期」でタイトル基底が綴り違いだと別グループになる（取りこぼし）。
 *     逆に「進撃の巨人」と「進撃の巨人 The Final Season」のように英語サブタイトルが
 *     付くと season マーカーを剥がせず別物扱いになることがある。
 *   - 完全に異なるが偶然語幹が一致する別IPは誤結合する（例: 一般名詞のみのタイトル）。
 *   - 公式のシリーズ/続編メタデータが入手できればそちらを優先すべき近似である。
 */
export function titleStem(title: string): string {
  if (!title) return "";

  // 1. 正規化
  let s = title.normalize("NFKC").toLowerCase().trim();

  // 2. 副題（：/ :）の除去 — 前置（基底）が4文字以上のときだけ落とす
  const colonIdx = s.search(/[:：]/);
  if (colonIdx >= 4) {
    s = s.slice(0, colonIdx).trim();
  }

  // 3. 末尾マーカーを繰り返し剥がす（複数付くケース「2期 後編」等に対応）
  let prev: string;
  do {
    prev = s;

    // 末尾の区切り・空白を先に整理
    s = s.replace(/[\s　・,，:：\-–—~〜「」『』()（）]+$/u, "").trim();

    // 第N期 / Nシーズン / Nクール（漢数字・全角数字も対象。NFKC後なので全角数字は半角化済）
    s = s.replace(
      /\s*第?\s*[0-9二三四五六七八九十]+\s*(期|シーズン|クール)$/u,
      "",
    );

    // part N / 後編・前編・完結編
    s = s.replace(/\s*(後編|前編|完結編|総集編|特別編)$/u, "");
    s = s.replace(/\s*part\s*[0-9]+$/u, "");
    s = s.replace(/\s*第?\s*[0-9]+\s*部$/u, "");

    // season N / Nnd|rd|th season
    s = s.replace(/\s*season\s*[0-9]+$/u, "");
    s = s.replace(/\s*[0-9]+(st|nd|rd|th)\s*season$/u, "");

    // 末尾のローマ数字 II/III/IV（NFKC で Ⅱ/Ⅲ/Ⅳ は ii/iii/iv に展開済み）。
    // 空白区切り（"オーバーロード ii"）、または CJK 文字に直結（"オーバーロードiii"）の
    // どちらも剥がす。ラテン語尾（"…vi" 等の英単語末尾）の誤爆を避けるため、
    // 直前がラテン英字のときは空白区切りのみ対象にする。
    s = s.replace(/(?<=[^\x00-\x7f])\s*(ii|iii|iv)$/u, "");
    s = s.replace(/\s+(ii|iii|iv|v)$/u, "");

    s = s.trim();
  } while (s !== prev && s.length > 0);

  // 4. 仕上げ — 末尾の区切り・空白を最終整理
  s = s.replace(/[\s　・,，:：\-–—~〜「」『』()（）]+$/u, "").trim();

  return s;
}

/** AniList 優先スコア（0-100）を解決する。両方 null なら null。 */
function resolveScore(anilistScore: number | null, malScore: number | null): number | null {
  if (anilistScore != null) return anilistScore;
  if (malScore != null) return Math.round(Number(malScore) * 10);
  return null;
}

/** クール（season_year, season_name）の暦順ソートキー。 */
function chronoKey(year: number | null, season: string | null): number {
  const y = year ?? 0;
  const r = season ? SEASON_RANK[season] ?? 0 : 0;
  return y * 4 + r;
}

/** クール表示ラベル（例「2024年 春」/ シーズン不明なら年のみ）。 */
function seasonLabel(year: number | null, season: string | null): string {
  if (!year) return "時期不明";
  const SEASON_JP: Record<string, string> = {
    winter: "冬",
    spring: "春",
    summer: "夏",
    autumn: "秋",
  };
  const sn = season ? SEASON_JP[season] : null;
  return sn ? `${year}年 ${sn}` : `${year}年`;
}

/* ================================================================
   型
   ================================================================ */

export interface FranchiseEntry {
  workId: string;
  title: string;
  seasonLabel: string;
  popularity: number;
  score: number | null; // AniList 優先・なければ MAL*10・無ければ null
}

export type FranchiseVerdict = "growing" | "stable" | "decaying" | null;

export interface FranchiseGroup {
  stem: string;
  /** 最新作（時系列で最後）のタイトル — 表示名に使う */
  latestTitle: string;
  /** 最新作のポスター/キービジュアルURL */
  posterUrl: string | null;
  /** 最新作の workId — 詳細リンク先 */
  latestWorkId: string;
  entriesCount: number;
  entries: FranchiseEntry[];
  /** last.popularity / first.popularity（round 2）。first<=0 なら null。 */
  popularityTrend: number | null;
  /** last.score - first.score。どちらか null なら null。 */
  scoreTrend: number | null;
  latestPopularity: number;
  verdict: FranchiseVerdict;
}

/** 内部用のワーク行。 */
interface WorkRow {
  id: string;
  title: string;
  season_year: number | null;
  season_name: string | null;
  popularity: number | null;
  anilist_score: number | null;
  mal_score: number | null;
  poster_url: string | null;
  key_visual_url: string | null;
  status: string | null;
}

/**
 * popularityTrend から verdict を分類する純関数。
 *   growing  : >= 1.1
 *   stable   : 0.7 .. 1.1（未満）
 *   decaying : < 0.7
 *   null     : トレンドなし（null）
 */
export function classifyVerdict(popularityTrend: number | null): FranchiseVerdict {
  if (popularityTrend == null) return null;
  if (popularityTrend >= 1.1) return "growing";
  if (popularityTrend >= 0.7) return "stable";
  return "decaying";
}

/* ================================================================
   DB アクセス層
   ================================================================ */

/**
 * フランチャイズ・モメンタムを返す（防御的・例外時は []）。
 *
 * 手順:
 *   1. season_year のある全 works をページネーションで取得。
 *   2. titleStem でグルーピング。同一タイトルは重複排除。
 *      シーズンが異なるエントリが2件以上あるグループのみ残す
 *      （同一クールの分割（split-cour）は season が同じなら1件としてのみカウント）。
 *   3. 各グループを暦順に並べ、エントリ配列とモメンタム指標を算出。
 *   4. growing を先頭に popularityTrend 降順でソートし、上位24グループに絞る。
 */
export async function getFranchiseMomentumUncached(): Promise<FranchiseGroup[]> {
  try {
    const db = getAdminClient();

    const rows: WorkRow[] = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await db
        .from("works")
        .select(
          "id, title, season_year, season_name, popularity, anilist_score, mal_score, poster_url, key_visual_url, status",
        )
        .not("season_year", "is", null)
        .range(from, from + 999);
      if (error) throw error;
      rows.push(...((data ?? []) as WorkRow[]));
      if (!data || data.length < 1000) break;
    }

    // titleStem でグルーピング
    const groups = new Map<string, WorkRow[]>();
    for (const w of rows) {
      if (!w.title) continue;
      const stem = titleStem(w.title);
      if (!stem) continue;
      if (!groups.has(stem)) groups.set(stem, []);
      groups.get(stem)!.push(w);
    }

    const result: FranchiseGroup[] = [];

    for (const [stem, members] of groups) {
      // 重複排除: 同一タイトルは1件に（同名の重複行を畳む）。
      const byTitle = new Map<string, WorkRow>();
      for (const w of members) {
        const key = w.title.normalize("NFKC").toLowerCase().trim();
        const existing = byTitle.get(key);
        // 同名が複数あれば popularity が大きい方を採用
        if (!existing || (w.popularity ?? 0) > (existing.popularity ?? 0)) {
          byTitle.set(key, w);
        }
      }
      const deduped = [...byTitle.values()];
      if (deduped.length < 2) continue;

      // シーズンが異なるエントリが2件以上あること
      // （同一 season_year+season_name の split-cour は1クールとして扱う）
      const seasonKeys = new Set(
        deduped.map((w) => `${w.season_year ?? ""}|${w.season_name ?? ""}`),
      );
      if (seasonKeys.size < 2) continue;

      // 同一クールに複数タイトルがある場合は popularity 最大の1件に畳む
      // （クール単位の代表作で時系列を組む）
      const bySeason = new Map<string, WorkRow>();
      for (const w of deduped) {
        const key = `${w.season_year ?? ""}|${w.season_name ?? ""}`;
        const existing = bySeason.get(key);
        if (!existing || (w.popularity ?? 0) > (existing.popularity ?? 0)) {
          bySeason.set(key, w);
        }
      }
      const ordered = [...bySeason.values()].sort(
        (a, b) =>
          chronoKey(a.season_year, a.season_name) -
          chronoKey(b.season_year, b.season_name),
      );

      if (ordered.length < 2) continue;

      const entries: FranchiseEntry[] = ordered.map((w) => ({
        workId: w.id,
        title: w.title,
        seasonLabel: seasonLabel(w.season_year, w.season_name),
        popularity: w.popularity ?? 0,
        score: resolveScore(w.anilist_score ?? null, w.mal_score ?? null),
      }));

      const first = entries[0];
      const last = entries[entries.length - 1];

      const popularityTrend =
        first.popularity > 0
          ? Math.round((last.popularity / first.popularity) * 100) / 100
          : null;

      const scoreTrend =
        first.score != null && last.score != null ? last.score - first.score : null;

      const lastWork = ordered[ordered.length - 1];

      result.push({
        stem,
        latestTitle: last.title,
        posterUrl: lastWork.poster_url ?? lastWork.key_visual_url ?? null,
        latestWorkId: last.workId,
        entriesCount: entries.length,
        entries,
        popularityTrend,
        scoreTrend,
        latestPopularity: last.popularity,
        verdict: classifyVerdict(popularityTrend),
      });
    }

    // growing を先頭に popularityTrend 降順、同点は latestPopularity 降順でソート。
    result.sort((a, b) => {
      const ga = a.verdict === "growing" ? 0 : 1;
      const gb = b.verdict === "growing" ? 0 : 1;
      if (ga !== gb) return ga - gb;
      const ta = a.popularityTrend ?? -Infinity;
      const tb = b.popularityTrend ?? -Infinity;
      if (tb !== ta) return tb - ta;
      return b.latestPopularity - a.latestPopularity;
    });

    return result.slice(0, 24);
  } catch {
    return [];
  }
}

/** フランチャイズ・モメンタムの LIVE 計算（30分メモ化）。スナップショット欠如時のフォールバック。 */
const getFranchiseMomentumLive = memoizeTTL(
  getFranchiseMomentumUncached,
  () => "franchise_momentum",
  1800000,
);

/**
 * フランチャイズ・モメンタム。
 * まず事前計算スナップショット("franchise_momentum")を読み、無ければ LIVE 計算へフォールバック。
 */
export function getFranchiseMomentum(): Promise<FranchiseGroup[]> {
  return fromSnapshotOrLive("franchise_momentum", getFranchiseMomentumLive);
}
