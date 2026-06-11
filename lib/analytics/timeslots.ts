/**
 * 放送曜日×時間帯ヒートマップのデータ層。
 *
 * 放送中作品（works.status='airing'）の本放送番組のうち、ニコニコ実況コメントを
 * 収集できたもの（analytics_collection_log の collected 行）について、
 * 開始時刻(JST)の「曜日 × 時間帯」ごとに平均コメント数を集計する。
 *
 * 母数はニコニコ実況のコメント数であり、テレビ視聴率ではない。
 * 「枠の盛り上がり」の近似指標。番組数が少ない枠はブレが大きい。
 *
 * 深夜帯は日本の放送習慣に合わせ、JST 5時未満を「前日の25時〜28時」として扱う
 * （例: 火曜 1:00 JST 開始 → 月曜 25時 枠）。
 */
import { getAdminClient } from "../supabase/admin.ts";
import { memoizeTTL } from "../cache.ts";
import { fromSnapshotOrLive } from "./snapshots.ts";
import { getCollectedLogs } from "./collectedLogs.ts";

// ---------------------------------------------------------------------------
// 競合スロット（放送枠の作品一覧）型定義
// ---------------------------------------------------------------------------

/** 各競合スロットに含まれる1作品の情報。 */
export interface CompetitionWork {
  workId: string;
  title: string;
  posterUrl: string | null;
}

/** 曜日×時間帯スロットごとの作品リストと作品数。 */
export interface TimeslotCompetitionSlot {
  weekday: number; // 0=月 .. 6=日
  hour: number; // 18..27（深夜は 24+ 表記）
  works: CompetitionWork[];
  count: number;
}

/** `getTimeslotCompetition` の戻り値。 */
export interface TimeslotCompetition {
  slots: TimeslotCompetitionSlot[];
}

/** 曜日ラベル（0=月 .. 6=日、深夜帯シフト後のインデックス） */
export const TIMESLOT_WEEKDAYS = ["月", "火", "水", "木", "金", "土", "日"] as const;

export interface TimeslotCell {
  weekday: number; // 0=月 .. 6=日
  hour: number; // 18..27（深夜は 24+ 表記。例: 25 = 翌1時）
  programs: number; // 集計対象番組数
  avgComments: number; // 平均コメント数（四捨五入）
}

export interface TimeslotHeatmap {
  cells: TimeslotCell[];
  maxAvg: number;
}

const chunk = <T,>(arr: T[], size: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
};

/**
 * UTC の start_at を JST の「放送習慣上の曜日・時間帯」へ変換する。
 * - JST = UTC + 9h。
 * - 5時未満は「前日の深夜枠」とみなし、hour に 24 を足し、曜日を1つ戻す（月曜25時 等）。
 * 返り値の weekday は 0=月 .. 6=日。
 */
export function toJstSlot(startAtIso: string): { weekday: number; hour: number } {
  const t = new Date(startAtIso).getTime();
  const jst = new Date(t + 9 * 3600 * 1000);
  // getUTCDay on the shifted timestamp gives the JST calendar weekday (0=Sun..6=Sat)
  let dow = jst.getUTCDay(); // 0=日 .. 6=土
  let hour = jst.getUTCHours();
  if (hour < 5) {
    hour += 24;
    dow = (dow + 6) % 7; // 前日へ
  }
  // 0=日..6=土 → 0=月..6=日 へ並べ替え
  const weekday = (dow + 6) % 7;
  return { weekday, hour };
}

/**
 * 放送曜日×時間帯ヒートマップの LIVE 計算。
 * - programs（放送中作品の本放送・再放送除外）× 収集済みコメント数
 * - JST の曜日・時間帯ごとに平均コメント数を集計
 * いかなる失敗でも cells:[] / maxAvg:0 を返す（UI を壊さない）。
 */
export async function getTimeslotHeatmapUncached(): Promise<TimeslotHeatmap> {
  try {
    const db = getAdminClient();

    // 収集済みログ（program_id → comment_count）。共有メモ化ヘルパーから取得。
    const logs = await getCollectedLogs();
    if (logs.length === 0) return { cells: [], maxAvg: 0 };
    const countByProgram = new Map(logs.map((l) => [l.program_id, l.comment_count]));

    // 放送中作品の本放送番組（再放送除外）。collected な番組IDに限定して引く。
    type Prog = { start_at: string; comments: number };
    const progs: Prog[] = [];
    for (const ids of chunk([...countByProgram.keys()], 150)) {
      const { data, error } = await db
        .from("programs")
        .select("id, start_at, works!inner(status)")
        .in("id", ids)
        .eq("is_rebroadcast", false)
        .eq("works.status", "airing");
      if (error) throw error;
      for (const p of (data ?? []) as { id: string; start_at: string | null }[]) {
        if (!p.start_at) continue;
        const c = countByProgram.get(p.id);
        if (c == null) continue;
        progs.push({ start_at: p.start_at, comments: c });
      }
    }
    if (progs.length === 0) return { cells: [], maxAvg: 0 };

    // {weekday,hour} ごとに集計
    const agg = new Map<string, { weekday: number; hour: number; programs: number; total: number }>();
    for (const p of progs) {
      const { weekday, hour } = toJstSlot(p.start_at);
      const key = `${weekday}:${hour}`;
      const cur = agg.get(key);
      if (cur) {
        cur.programs += 1;
        cur.total += p.comments;
      } else {
        agg.set(key, { weekday, hour, programs: 1, total: p.comments });
      }
    }

    const cells: TimeslotCell[] = [];
    let maxAvg = 0;
    for (const a of agg.values()) {
      if (a.programs < 1) continue;
      const avgComments = Math.round(a.total / a.programs);
      cells.push({ weekday: a.weekday, hour: a.hour, programs: a.programs, avgComments });
      if (avgComments > maxAvg) maxAvg = avgComments;
    }

    return { cells, maxAvg };
  } catch {
    return { cells: [], maxAvg: 0 };
  }
}

/** 放送枠ヒートマップの LIVE 計算（30分メモ化）。スナップショット欠如時のフォールバック。 */
const getTimeslotHeatmapLive = memoizeTTL(getTimeslotHeatmapUncached, () => "timeslot", 1800000);

/**
 * 放送曜日×時間帯ヒートマップ。
 * まず事前計算スナップショット("timeslot_heatmap")を読み、無ければ LIVE 計算へフォールバック。
 */
export function getTimeslotHeatmap(): Promise<TimeslotHeatmap> {
  return fromSnapshotOrLive("timeslot_heatmap", getTimeslotHeatmapLive);
}

/**
 * 今期放送中作品を曜日×時間帯スロットへ割当て、各スロットの作品リスト＋作品数を返す。
 * works + programs（本放送・代表局1つ）から。
 * いかなる失敗でも slots:[] を返す（UI を壊さない）。
 */
export async function getTimeslotCompetitionUncached(): Promise<TimeslotCompetition> {
  try {
    const db = getAdminClient();

    // 放送中作品の本放送番組（代表局1つ = 最初にヒットしたもの）を取得。
    // works.status='airing' かつ is_rebroadcast=false 。
    type ProgramRow = {
      start_at: string | null;
      works: {
        id: string;
        title: string;
        image_url: string | null;
      };
    };

    // 全件が必要なため、1000件上限でフェッチ（今期放送中は通常300件未満）。
    const { data, error } = await db
      .from("programs")
      .select("start_at, works!inner(id, title, image_url)")
      .eq("is_rebroadcast", false)
      .eq("works.status", "airing")
      .not("start_at", "is", null)
      .limit(1000);

    if (error) throw error;
    const rows = (data ?? []) as unknown as ProgramRow[];

    // 作品ごとに1スロット（代表番組1つ）に集約するため、work_id → 最初の有効なスロットのみ使う。
    const workSeen = new Set<string>();
    const slotMap = new Map<string, { weekday: number; hour: number; works: CompetitionWork[] }>();

    for (const row of rows) {
      if (!row.start_at) continue;
      const work = row.works;
      if (!work?.id) continue;
      // 同じ作品が複数局で放送されている場合は最初の1件のみ採用。
      if (workSeen.has(work.id)) continue;
      workSeen.add(work.id);

      const { weekday, hour } = toJstSlot(row.start_at);
      const key = `${weekday}:${hour}`;
      const slot = slotMap.get(key);
      const entry: CompetitionWork = {
        workId: work.id,
        title: work.title,
        posterUrl: work.image_url ?? null,
      };
      if (slot) {
        slot.works.push(entry);
      } else {
        slotMap.set(key, { weekday, hour, works: [entry] });
      }
    }

    const slots: TimeslotCompetitionSlot[] = [];
    for (const s of slotMap.values()) {
      slots.push({ weekday: s.weekday, hour: s.hour, works: s.works, count: s.works.length });
    }
    // 競合の多い順にソート。
    slots.sort((a, b) => b.count - a.count);

    return { slots };
  } catch {
    return { slots: [] };
  }
}

/** 競合スロット計算の LIVE メモ化（30分）。スナップショット欠如時のフォールバック。 */
const getTimeslotCompetitionLive = memoizeTTL(
  getTimeslotCompetitionUncached,
  () => "timeslot_competition",
  1800000,
);

/**
 * 今期放送中作品を曜日×時間帯スロットへ割当て、各スロットの競合情報を返す。
 * まず事前計算スナップショット("timeslot_competition")を読み、無ければ LIVE 計算へフォールバック。
 */
export function getTimeslotCompetition(): Promise<TimeslotCompetition> {
  return fromSnapshotOrLive("timeslot_competition", getTimeslotCompetitionLive);
}

/**
 * 最も盛り上がる枠を1行で要約する純関数。
 * 番組数 3 以上の枠の中で平均コメント数が最大のものを選ぶ。
 * 該当なし・データ不足では null を返す。
 */
export function timeslotInsight(cells: TimeslotCell[]): string | null {
  const eligible = cells.filter((c) => c.programs >= 3);
  if (eligible.length === 0) return null;
  const top = eligible.reduce((a, b) => (b.avgComments > a.avgComments ? b : a));
  const dow = TIMESLOT_WEEKDAYS[top.weekday] ?? "?";
  return `最も盛り上がる枠は${dow}${top.hour}時（平均${top.avgComments.toLocaleString()}コメ・${top.programs}番組）。`;
}
