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
function EpisodePosts({ posts, max = 3 }: { posts: XBuzzPost[]; max?: number }) {
  const list = posts.filter((p) => p.text && p.text.trim().length > 0).slice(0, max);
  if (list.length === 0) return null;
  return (
    <ul className="mt-2 space-y-1">
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
            {p.text!.length > 64 ? `${p.text!.slice(0, 64)}…` : p.text}
          </span>
        </li>
      ))}
    </ul>
  );
}

/**
 * 話数ごとの X 評価を縦に並べる。各話: 話数ラベル＋volumeゲージ＋sentiment＋topics＋
 * （あれば）その話の声サマリ＋代表ポスト。話数別に X の反応を追えるようにするのが狙い。
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
        const sum =
          ep.summary && ep.summary.length > 220 ? `${ep.summary.slice(0, 220)}…` : ep.summary;
        const eps = ep.episodeId ? (postsByEpisode.get(ep.episodeId) ?? []) : [];
        return (
          <li
            key={`${ep.episodeId ?? ep.episodeLabel}-${ep.capturedAt}-${i}`}
            className="rounded-lg bg-paper/60 px-3 py-2.5"
          >
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
            {ep.topics.length > 0 && (
              <div className="mt-1.5">
                <TopicChips topics={ep.topics} max={6} />
              </div>
            )}
            {sum && (
              <p className="mt-1.5 text-[0.78rem] leading-relaxed text-ink-soft whitespace-pre-wrap">
                {sum}
              </p>
            )}
            <EpisodePosts posts={eps} />
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

  const summary =
    buzz?.summary && buzz.summary.length > 600
      ? `${buzz.summary.slice(0, 600)}…`
      : (buzz?.summary ?? null);
  const citations = buzz?.citations.slice(0, 8) ?? [];
  const episodes = buzz?.episodes ?? [];

  // 実ポストを episode_id ごとにまとめ、話数別の代表ポスト表示に使う。
  const postsByEpisode = new Map<string, XBuzzPost[]>();
  for (const p of posts) {
    if (!p.episodeId) continue;
    const arr = postsByEpisode.get(p.episodeId);
    if (arr) arr.push(p);
    else postsByEpisode.set(p.episodeId, [p]);
  }

  return (
    <section className="card p-5 sm:p-6">
      <h2 className="section-title text-lg mb-4">Xの反応（X Premium・x_search）</h2>

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

      {/* 話ごとの評価（話数別の盛り上がり一覧 ＋ 各話の声） */}
      {episodes.length > 0 && (
        <div className="mb-5">
          <h3 className="text-xs font-bold text-muted mb-2">話ごとの評価</h3>
          <EpisodeBuzzList episodes={episodes} postsByEpisode={postsByEpisode} />
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
