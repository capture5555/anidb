/**
 * X(Twitter) バズの作品ページ向け表示（サーバーコンポーネント, "use client" なし）。
 *
 * Grok の x_search 分析（作品/話数レベルの volume・sentiment・topics・summary・citations）と
 * x_search で集めた実ポスト（getWorkXPosts）を、参考値として控えめに描画する。
 *
 * すべて防御的: X データがまだ無い（buzz=null かつ posts=[]）ときは null を返して丸ごと非表示にする。
 * 各セクションも個別に「データがある場合のみ」描画するため、部分的な蓄積状況でも崩れない。
 */
import type { WorkXBuzz } from "@/lib/analytics/xbuzz";
import { xBuzzSectionComment } from "@/lib/analytics/sectionComments";
import { SectionNote } from "./WorkAnalysisSections";
import { EpisodeBuzzSelector } from "./EpisodeBuzzSelector";

interface XBuzzPost {
  statusId: string;
  url: string;
  text: string | null;
  postedAt: string;
  episodeId: string | null;
}

/* ---------------------------------------------------------------- sentiment chip */

/** sentiment を emerald/amber/rose のチップにマップ。未知/欠落は控えめなグレー。 */
function SentimentChip({ sentiment }: { sentiment: string | null }) {
  if (!sentiment) return null;
  const s = sentiment.toLowerCase();
  const config: { cls: string; label: string } | null =
    s === "positive"
      ? { cls: "bg-emerald-100 text-emerald-700", label: "ポジティブ" }
      : s === "mixed"
        ? { cls: "bg-amber-100 text-amber-700", label: "賛否両論" }
        : s === "negative"
          ? { cls: "bg-rose-100 text-rose-700", label: "ネガティブ" }
          : null;
  if (!config) return null;
  return (
    <span
      className={`inline-block text-[0.66rem] font-bold px-2 py-0.5 rounded-full whitespace-nowrap ${config.cls}`}
    >
      {config.label}
    </span>
  );
}

/* ---------------------------------------------------------------- volume gauge */

/** volume 0-5 を5セグメントのゲージで表現。 */
function VolumeGauge({ volume, size = "md" }: { volume: number; size?: "sm" | "md" }) {
  const filled = Math.max(0, Math.min(5, Math.round(volume)));
  const seg = size === "sm" ? "h-1.5 w-3" : "h-2.5 w-5";
  return (
    <div className="flex items-center gap-0.5" aria-label={`盛り上がり ${filled}/5`}>
      {[0, 1, 2, 3, 4].map((i) => (
        <span
          key={i}
          className={`${seg} rounded-[2px] ${i < filled ? "bg-accent" : "bg-paper"}`}
        />
      ))}
    </div>
  );
}

/* ---------------------------------------------------------------- topic chips */

function TopicChips({ topics, max = 8 }: { topics: string[]; max?: number }) {
  const list = topics.slice(0, max);
  if (list.length === 0) return null;
  return (
    <ul className="flex flex-wrap gap-1.5">
      {list.map((t) => (
        <li
          key={t}
          className="text-[0.72rem] font-medium text-ink-soft bg-paper rounded-full px-2.5 py-0.5"
        >
          {t}
        </li>
      ))}
    </ul>
  );
}

/* ---------------------------------------------------------------- url shorten */

/** 表示用にURLを短縮（host + 末尾pathの先頭程度）。 */
function shortenUrl(url: string): string {
  try {
    const u = new URL(url);
    const path = u.pathname.replace(/\/$/, "");
    const tail = path.length > 24 ? `${path.slice(0, 24)}…` : path;
    return `${u.hostname.replace(/^www\./, "")}${tail}`;
  } catch {
    return url.length > 40 ? `${url.slice(0, 40)}…` : url;
  }
}

/* ---------------------------------------------------------------- posts timeline */

/** JST(UTC+9)での YYYY-MM-DD を返す。 */
function jstDateKey(iso: string): string | null {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  const jst = new Date(t + 9 * 60 * 60 * 1000);
  const y = jst.getUTCFullYear();
  const m = String(jst.getUTCMonth() + 1).padStart(2, "0");
  const d = String(jst.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** sentiment 文字列を日本語ラベル＋色に。日別評判の集計表示用。 */
function sentimentLabel(s: string | null): { label: string; cls: string } | null {
  if (!s) return null;
  const v = s.toLowerCase();
  if (v === "positive") return { label: "ポジティブ", cls: "text-emerald-700" };
  if (v === "mixed") return { label: "賛否両論", cls: "text-amber-700" };
  if (v === "negative") return { label: "ネガティブ", cls: "text-rose-700" };
  return null;
}

/**
 * 日別の反応を「数字」で見せる表。
 * - 投稿数: x_searchで集めた実ポストを JST 日付ごとに集計。
 * - バズ/評判: 作品レベルのバズ計測(trend, 3hごと)を JST 日付ごとに平均volume＋多数決sentimentで集計。
 * 直近のある日から最大14日ぶんを新しい順に。データのある日だけ表示。
 */
function DailyBuzzTable({
  posts,
  trend,
}: {
  posts: XBuzzPost[];
  trend: { capturedAt: string; volume: number; sentiment: string | null }[];
}) {
  // 投稿数（日別）
  const postCount = new Map<string, number>();
  for (const p of posts) {
    const k = jstDateKey(p.postedAt);
    if (k) postCount.set(k, (postCount.get(k) ?? 0) + 1);
  }
  // バズ計測（日別: volume平均・sentiment多数決）
  const volSum = new Map<string, { sum: number; n: number }>();
  const sentVotes = new Map<string, Map<string, number>>();
  for (const t of trend) {
    const k = jstDateKey(t.capturedAt);
    if (!k) continue;
    const v = volSum.get(k) ?? { sum: 0, n: 0 };
    v.sum += t.volume;
    v.n += 1;
    volSum.set(k, v);
    if (t.sentiment) {
      const votes = sentVotes.get(k) ?? new Map<string, number>();
      votes.set(t.sentiment, (votes.get(t.sentiment) ?? 0) + 1);
      sentVotes.set(k, votes);
    }
  }

  const days = new Set<string>([...postCount.keys(), ...volSum.keys()]);
  if (days.size === 0) return null;
  const sorted = [...days].sort().reverse().slice(0, 14); // 新しい順・最大14日

  const dominantSentiment = (k: string): string | null => {
    const votes = sentVotes.get(k);
    if (!votes) return null;
    let best: string | null = null;
    let bestN = 0;
    for (const [s, n] of votes) {
      if (n > bestN) {
        best = s;
        bestN = n;
      }
    }
    return best;
  };

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[360px] text-sm border-collapse">
        <thead>
          <tr className="text-[0.68rem] text-muted border-b border-line">
            <th className="text-left font-bold py-1.5 pr-3">日付(JST)</th>
            <th className="text-right font-bold py-1.5 px-2 w-20">投稿数</th>
            <th className="text-center font-bold py-1.5 px-2 w-16">バズ</th>
            <th className="text-left font-bold py-1.5 pl-2 w-24">評判</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((k) => {
            const pc = postCount.get(k) ?? 0;
            const v = volSum.get(k);
            const avgVol = v && v.n > 0 ? Math.round((v.sum / v.n) * 10) / 10 : null;
            const sent = sentimentLabel(dominantSentiment(k));
            const md = k.slice(5).replace("-", "/");
            return (
              <tr key={k} className="border-b border-line/60">
                <td className="py-1.5 pr-3 tabular-nums text-xs text-ink-soft">{md}</td>
                <td className="py-1.5 px-2 text-right tabular-nums text-xs font-bold text-ink">
                  {pc > 0 ? pc.toLocaleString() : "—"}
                </td>
                <td className="py-1.5 px-2 text-center tabular-nums text-xs font-bold text-accent">
                  {avgVol != null ? `${avgVol}` : "—"}
                </td>
                <td className={`py-1.5 pl-2 text-xs font-bold ${sent?.cls ?? "text-muted"}`}>
                  {sent?.label ?? "—"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/**
 * 直近~14日のポスト件数を日次でバケットし、インラインSVGの棒グラフにする。
 * 母数が小さいため相対傾向の目安。
 */
function PostsTimeline({ posts }: { posts: XBuzzPost[] }) {
  // JST日付ごとにカウント
  const counts = new Map<string, number>();
  for (const p of posts) {
    const key = jstDateKey(p.postedAt);
    if (!key) continue;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  if (counts.size === 0) return null;

  // 直近の日付を末尾基準に14日ぶんの連続レンジを作る。
  const sortedKeys = [...counts.keys()].sort();
  const lastKey = sortedKeys[sortedKeys.length - 1];
  const lastMs = Date.parse(`${lastKey}T00:00:00Z`);
  const DAYS = 14;
  const buckets: { key: string; label: string; count: number }[] = [];
  for (let i = DAYS - 1; i >= 0; i--) {
    const ms = lastMs - i * 24 * 60 * 60 * 1000;
    const d = new Date(ms);
    const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(
      d.getUTCDate(),
    ).padStart(2, "0")}`;
    buckets.push({
      key,
      label: `${d.getUTCMonth() + 1}/${d.getUTCDate()}`,
      count: counts.get(key) ?? 0,
    });
  }

  const W = 560;
  const H = 120;
  const PAD = { top: 8, right: 8, bottom: 20, left: 8 };
  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;
  const maxCount = Math.max(1, ...buckets.map((b) => b.count));
  const slot = innerW / buckets.length;
  const barW = Math.max(4, slot * 0.62);

  return (
    <div className="overflow-x-auto">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full min-w-[420px]"
        role="img"
        aria-label="X投稿件数の日次推移"
      >
        {/* ベースライン */}
        <line
          x1={PAD.left}
          x2={W - PAD.right}
          y1={H - PAD.bottom}
          y2={H - PAD.bottom}
          stroke="#e8eaef"
        />
        {buckets.map((b, i) => {
          const h = (b.count / maxCount) * innerH;
          const x = PAD.left + i * slot + (slot - barW) / 2;
          const y = H - PAD.bottom - h;
          return (
            <g key={b.key}>
              <rect
                x={x}
                y={y}
                width={barW}
                height={h}
                rx={2}
                fill="#2f6fdb"
                fillOpacity={b.count > 0 ? 0.7 : 0}
              >
                <title>{`${b.label}: ${b.count}件`}</title>
              </rect>
              {(i % 2 === 0 || i === buckets.length - 1) && (
                <text
                  x={PAD.left + i * slot + slot / 2}
                  y={H - 6}
                  textAnchor="middle"
                  fontSize="9"
                  fill="#8a909c"
                >
                  {b.label}
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

/* ---------------------------------------------------------------- episode buzz list */

/** 1話ぶんの代表ポスト（最大n件）を小さなリンク列で出す。 */
function EpisodePosts({ posts, max = 5 }: { posts: XBuzzPost[]; max?: number }) {
  const list = posts.filter((p) => p.text && p.text.trim().length > 0).slice(0, max);
  if (list.length === 0) return null;
  return (
    <ul className="mt-1.5 space-y-1">
      {list.map((p) => (
        <li key={p.statusId} className="text-[0.72rem] text-ink-soft leading-snug">
          <a
            href={p.url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary hover:underline underline-offset-2"
          >
            ▸
          </a>{" "}
          <span className="text-muted">
            {p.text!.length > 80 ? `${p.text!.slice(0, 80)}…` : p.text}
          </span>
        </li>
      ))}
    </ul>
  );
}

/* ---------------------------------------------------------------- episode mini bar chart */

/**
 * 1話分の実ポストを JST 日付ごとに集計し、小さなインライン棒グラフで「投稿傾向」を見せる。
 * ポスト数が3件未満のときは棒グラフを出さず数値のみ。
 */
function EpisodePostsTrend({ posts }: { posts: XBuzzPost[] }) {
  if (posts.length === 0) return null;

  // JST日付ごとにカウント
  const counts = new Map<string, number>();
  for (const p of posts) {
    const key = jstDateKey(p.postedAt);
    if (!key) continue;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  if (counts.size === 0) return null;

  const total = posts.length;
  const sortedDays = [...counts.keys()].sort();

  // 件数が少ない話（3件未満 or 1日のみ）は数値のみ表示
  if (total < 3 || sortedDays.length <= 1) {
    const peakDay = sortedDays.reduce(
      (best, k) => (counts.get(k)! > (counts.get(best) ?? 0) ? k : best),
      sortedDays[0],
    );
    const peakLabel = peakDay ? peakDay.slice(5).replace("-", "/") : null;
    return (
      <p className="text-[0.68rem] text-muted mt-1.5">
        投稿傾向: 計 <span className="font-bold text-ink-soft tabular-nums">{total}</span> 件
        {peakLabel ? `（${peakLabel}）` : ""}
      </p>
    );
  }

  // 棒グラフ: 全日付を連続レンジにして表示（最大14日）
  const lastKey = sortedDays[sortedDays.length - 1];
  const firstKey = sortedDays[0];
  const lastMs = Date.parse(`${lastKey}T00:00:00Z`);
  const firstMs = Date.parse(`${firstKey}T00:00:00Z`);
  const daySpan = Math.round((lastMs - firstMs) / (24 * 60 * 60 * 1000)) + 1;
  const DAYS = Math.min(14, daySpan);

  const buckets: { key: string; label: string; count: number }[] = [];
  for (let i = DAYS - 1; i >= 0; i--) {
    const ms = lastMs - i * 24 * 60 * 60 * 1000;
    const d = new Date(ms);
    const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
    buckets.push({
      key,
      label: `${d.getUTCMonth() + 1}/${d.getUTCDate()}`,
      count: counts.get(key) ?? 0,
    });
  }

  const maxCount = Math.max(1, ...buckets.map((b) => b.count));
  // ピーク日ラベル（最多投稿日）
  const peakBucket = buckets.reduce((best, b) => (b.count > best.count ? b : best), buckets[0]);

  // インライン SVG: 幅 220px 固定、高さ 36px（バー 24px + ラベル 12px）
  const W = 220;
  const BAR_H = 24;
  const LABEL_H = 12;
  const H = BAR_H + LABEL_H;
  const slot = W / buckets.length;
  const barW = Math.max(3, slot * 0.65);

  return (
    <div className="mt-1.5">
      <p className="text-[0.68rem] text-muted mb-0.5">
        投稿傾向: 計{" "}
        <span className="font-bold text-ink-soft tabular-nums">{total}</span> 件 ·
        ピーク {peakBucket.label}（{peakBucket.count}件）
      </p>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full max-w-[240px]"
        role="img"
        aria-label={`この話のX投稿傾向: 計${total}件`}
      >
        {/* ベースライン */}
        <line x1={0} x2={W} y1={BAR_H} y2={BAR_H} stroke="#e8eaef" strokeWidth={1} />
        {buckets.map((b, i) => {
          const h = maxCount > 0 ? (b.count / maxCount) * (BAR_H - 2) : 0;
          const x = i * slot + (slot - barW) / 2;
          const y = BAR_H - h;
          const isPeak = b.count === maxCount && maxCount > 0;
          return (
            <g key={b.key}>
              <rect
                x={x}
                y={y}
                width={barW}
                height={h}
                rx={1.5}
                fill={isPeak ? "#2f6fdb" : "#2f6fdb"}
                fillOpacity={b.count > 0 ? (isPeak ? 0.85 : 0.45) : 0}
              >
                <title>{`${b.label}: ${b.count}件`}</title>
              </rect>
              {/* 日付ラベル: 最初・最後・ピーク日のみ */}
              {(i === 0 || i === buckets.length - 1 || isPeak) && (
                <text
                  x={i * slot + slot / 2}
                  y={H - 1}
                  textAnchor="middle"
                  fontSize="8"
                  fill={isPeak ? "#2f6fdb" : "#8a909c"}
                >
                  {b.label}
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

/**
 * 話数ごとの X 評価を縦に並べる。各話: 話数ラベル＋volumeゲージ＋sentiment＋topics＋
 * 投稿傾向（mini棒グラフ）＋AI所感（summary）＋投稿事例（代表ポスト）。
 * 話数別に X の反応を追えるようにするのが狙い。
 */
function EpisodeBuzzList({
  episodes,
  postsByEpisode,
}: {
  episodes: WorkXBuzz["episodes"];
  postsByEpisode: Map<string, XBuzzPost[]>;
}) {
  return (
    <ul className="space-y-3">
      {episodes.map((ep, i) => {
        const sum = ep.summary;
        const eps = ep.episodeId ? (postsByEpisode.get(ep.episodeId) ?? []) : [];
        const hasPostData = eps.length > 0;
        const hasSamplePosts = eps.some((p) => p.text && p.text.trim().length > 0);
        return (
          <li
            key={`${ep.episodeId ?? ep.episodeLabel}-${ep.capturedAt}-${i}`}
            className="rounded-lg bg-paper/60 px-3 py-2.5"
          >
            {/* ヘッダー: 話数ラベル + volume + sentiment */}
            <div className="flex flex-wrap items-center gap-2.5">
              <span className="text-xs font-bold text-ink-soft tabular-nums">
                {ep.episodeLabel}
              </span>
              <VolumeGauge volume={ep.volume} size="sm" />
              <span className="text-[0.68rem] font-bold text-muted tabular-nums">
                {Math.max(0, Math.min(5, Math.round(ep.volume)))}/5
              </span>
              <SentimentChip sentiment={ep.sentiment} />
            </div>

            {/* トピックチップ */}
            {ep.topics.length > 0 && (
              <div className="mt-1.5">
                <TopicChips topics={ep.topics} max={6} />
              </div>
            )}

            {/* 投稿傾向: 実ポストの日別件数ミニグラフ */}
            {hasPostData && (
              <EpisodePostsTrend posts={eps} />
            )}

            {/* AI所感: Grokのsummaryを明示ラベルで表示 */}
            {sum && (
              <div className="mt-2 rounded-md bg-paper px-2.5 py-2">
                <p className="text-[0.65rem] font-bold text-muted mb-1">AI所感（Grok要約）</p>
                <p className="text-[0.78rem] leading-relaxed text-ink-soft whitespace-pre-wrap">
                  {sum}
                </p>
              </div>
            )}

            {/* 投稿事例: 本文がある実ポストを最大5件 */}
            {hasSamplePosts && (
              <div className="mt-2">
                <p className="text-[0.65rem] font-bold text-muted mb-0.5">投稿事例</p>
                <EpisodePosts posts={eps} />
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/* ================================================================ section */

export function XBuzzSection({
  buzz,
  posts,
}: {
  buzz: WorkXBuzz | null;
  posts: XBuzzPost[];
}) {
  // X データがまだ何も無ければ丸ごと非表示。
  if (!buzz && posts.length === 0) return null;

  // 作品の声は全文表示する（途中で「…」と切らない）。
  const summary = buzz?.summary ?? null;
  const citations = buzz?.citations.slice(0, 8) ?? [];
  const episodes = buzz?.episodes ?? [];

  // 実ポストを episode_id ごとにまとめ、話数別の代表ポスト表示に使う。
  // クライアントコンポーネントへ渡すため Map ではなく Record を使う（Map はシリアライズ不可）。
  const postsByEpisode: Record<string, XBuzzPost[]> = {};
  for (const p of posts) {
    if (!p.episodeId) continue;
    if (!postsByEpisode[p.episodeId]) postsByEpisode[p.episodeId] = [];
    postsByEpisode[p.episodeId].push(p);
  }

  return (
    <section className="card p-5 sm:p-6">
      <h2 className="section-title text-lg mb-4">Xの反応（X Premium・x_search）</h2>

      {buzz && <SectionNote text={xBuzzSectionComment(buzz)} />}

      {/* 現在の盛り上がり */}
      {buzz && (
        <div className="mb-5">
          <h3 className="text-xs font-bold text-muted mb-2">現在の盛り上がり</h3>
          <div className="flex flex-wrap items-center gap-3">
            <VolumeGauge volume={buzz.volume} />
            <span className="text-xs font-bold text-ink-soft tabular-nums">
              {Math.max(0, Math.min(5, Math.round(buzz.volume)))}/5
            </span>
            <SentimentChip sentiment={buzz.sentiment} />
          </div>
          {buzz.topics.length > 0 && (
            <div className="mt-2.5">
              <TopicChips topics={buzz.topics} />
            </div>
          )}
        </div>
      )}

      {/* 作品の声（summary + 代表ポスト） */}
      {(summary || citations.length > 0) && (
        <div className="mb-5">
          <h3 className="text-xs font-bold text-muted mb-2">作品の声</h3>
          {summary && (
            <p className="text-[0.9rem] leading-[1.85] text-ink-soft whitespace-pre-wrap">
              {summary}
            </p>
          )}
          {citations.length > 0 && (
            <div className="mt-3">
              <p className="text-[0.7rem] font-bold text-muted mb-1.5">代表ポスト</p>
              <ul className="space-y-1">
                {citations.map((c) => (
                  <li key={c.url}>
                    <a
                      href={c.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-primary hover:underline underline-offset-2 break-all"
                    >
                      {shortenUrl(c.url)} ↗
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {/* 話ごとの評価（話数ピルで選択 → 1話分の volume/sentiment/topics/AI所感/投稿一覧） */}
      {episodes.length > 0 && (
        <div className="mb-5">
          <h3 className="text-xs font-bold text-muted mb-2">話ごとの評価</h3>
          <EpisodeBuzzSelector episodes={episodes} postsByEpisode={postsByEpisode} />
        </div>
      )}

      {/* 日別の反応（投稿数・バズ・評判を数字で） */}
      {(posts.length > 0 || (buzz?.trend.length ?? 0) > 0) && (
        <div className="mb-5">
          <h3 className="text-xs font-bold text-muted mb-2">日別の反応（数字）</h3>
          <DailyBuzzTable posts={posts} trend={buzz?.trend ?? []} />
          <p className="text-[0.68rem] text-muted mt-1.5 leading-relaxed">
            投稿数＝x_searchで集めた実ポストの日次件数（JST）。バズ＝その日のバズ計測の平均（0〜5）、評判＝その日の多数派センチメント。
          </p>
        </div>
      )}

      {/* X投稿タイムライン（実ポストが十分にある場合のみ） */}
      {posts.length >= 8 && (
        <div className="mb-5">
          <h3 className="text-xs font-bold text-muted mb-2">X投稿タイムライン</h3>
          <PostsTimeline posts={posts} />
          <p className="text-[0.68rem] text-muted mt-1.5 leading-relaxed">
            x_searchで集めた実ポストの投稿時刻（tweet
            idから復元）。サンプルのため相対傾向。叩くほど密度が上がります。
          </p>
        </div>
      )}

      {/* 注意書き */}
      <p className="text-[0.68rem] text-muted leading-relaxed">
        ※ Grokのx_search分析＋サンプルポストに基づく参考値。ニコニコ実況(全量)とは母数が異なる。
      </p>
    </section>
  );
}
