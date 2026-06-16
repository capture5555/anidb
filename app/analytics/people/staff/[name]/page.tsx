import Link from "next/link";
import type { Metadata } from "next";
import { getStaffDetailFn, type StaffDetail, type PersonYearStat, type PersonWork } from "@/lib/analytics/people";
import { WorkCover } from "@/components/WorkCover";
import { formatSeason } from "@/lib/season";
import { formatPopularity } from "@/lib/format";
import type { Season } from "@/lib/types";

export const revalidate = 1800;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ name: string }>;
}): Promise<Metadata> {
  const { name } = await params;
  const decoded = decodeURIComponent(name);
  const detail = await getStaffDetailFn(decoded).catch(() => null);
  const displayName = detail?.name ?? decoded;
  return { title: `${displayName} — スタッフ分析` };
}

function formatBa(ba: number): string {
  return `.${String(Math.round(ba * 1000)).padStart(3, "0")}`;
}

function seasonLabel(year: number | null, name: string | null): string {
  return formatSeason(year, (name as Season | null) ?? null);
}

export default async function StaffDetailPage({
  params,
}: {
  params: Promise<{ name: string }>;
}) {
  const { name } = await params;
  const decoded = decodeURIComponent(name);
  const detail = await getStaffDetailFn(decoded).catch(() => null);

  if (!detail) {
    return (
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <Breadcrumb name={decoded} />
        <div className="card mt-3 p-8 text-center text-sm text-muted">
          「{decoded}」のデータがまだありません。
          <br />
          スコア付き担当作品が少ない可能性があります。
          <div className="mt-4">
            <Link href="/analytics?view=people" className="text-primary font-bold hover:underline underline-offset-2">
              人材データへ戻る →
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl px-4 sm:px-6">
      <Breadcrumb name={detail.name} />

      {/* ヘッダーカード */}
      <header className="card mt-3 p-5 sm:p-6">
        <p className="text-xs font-bold text-accent">スタッフ 個人分析</p>
        <h1 className="text-xl sm:text-2xl font-black leading-snug mt-1">{detail.name}</h1>
        {detail.roles.length > 0 && (
          <p className="text-xs text-muted mt-1">{detail.roles.join(" / ")}</p>
        )}

        <div className="mt-4 grid grid-cols-2 sm:grid-cols-3 gap-3">
          <Stat label="担当作品数" value={`${detail.worksCount}`} />
          <Stat label="平均スコア" value={detail.scoredWorks > 0 ? `${detail.avgScore}` : "—"} />
          <Stat label="打率" value={formatBa(detail.battingAverage)} />
        </div>

        <p className="text-[0.68rem] text-muted mt-4 leading-relaxed">
          打率＝担当作が同クールのスコア中央値以上だった割合。スコアはAniList優先、なければMAL換算。
          ※ 各サービス利用者を母数とした参考値です。
        </p>
      </header>

      <div className="space-y-5 py-5">
        {/* 代表作・ハイライト */}
        {detail.highlights.length > 0 && (
          <section className="card p-5 sm:p-6">
            <h2 className="section-title text-lg mb-1">代表作・ハイライト</h2>
            <p className="text-xs text-muted mb-4">スコア上位・人気上位の作品。</p>
            <ul className="divide-y divide-line">
              {detail.highlights.map((w) => (
                <WorkListItem key={w.workId} w={w} showRole />
              ))}
            </ul>
          </section>
        )}

        {/* スコア・打率の推移 */}
        {detail.yearStats.length > 0 && (
          <section className="card p-5 sm:p-6">
            <h2 className="section-title text-lg mb-1">年別スコア・打率の推移</h2>
            <p className="text-xs text-muted mb-4">
              スコア付き作品の年別平均スコアと打率（直近{detail.yearStats.length}年）。
            </p>
            <YearStatChart data={detail.yearStats} />
          </section>
        )}

        {/* 参加作品一覧 */}
        <section className="card p-5 sm:p-6">
          <h2 className="section-title text-lg mb-1">担当作品一覧</h2>
          <p className="text-xs text-muted mb-4">
            担当作品（新しいクール順）。全{detail.worksCount}本。
          </p>
          {detail.works.length === 0 ? (
            <p className="text-sm text-muted">作品がありません。</p>
          ) : (
            <ul className="divide-y divide-line">
              {detail.works.map((w) => (
                <WorkListItem key={w.workId} w={w} showRole />
              ))}
            </ul>
          )}
        </section>

        {/* 共演・協業の多い相手 */}
        {(detail.coActors.length > 0 || detail.coStaff.length > 0) && (
          <section className="card p-5 sm:p-6">
            <h2 className="section-title text-lg mb-1">共演・協業の多い相手</h2>
            <p className="text-xs text-muted mb-4">同じ作品に多く携わっている声優・スタッフ。</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
              {detail.coActors.length > 0 && (
                <CoList title="共演声優" items={detail.coActors} />
              )}
              {detail.coStaff.length > 0 && (
                <CoList title="よく組むスタッフ" items={detail.coStaff} />
              )}
            </div>
          </section>
        )}

        <p className="text-xs text-muted leading-relaxed">
          ※ スタッフの同定はクレジット表記のテキストに基づく近似であり、表記ゆれ等で精度に限界があります。
          スコアはAniList/MAL由来の参考値です。
        </p>
      </div>
    </div>
  );
}

function Breadcrumb({ name }: { name: string }) {
  return (
    <div className="pt-4 text-xs text-muted">
      <Link href="/analytics" className="hover:text-primary">
        アニメ分析
      </Link>
      <span className="mx-1.5">›</span>
      <Link href="/analytics?view=people" className="hover:text-primary">
        人材
      </Link>
      <span className="mx-1.5">›</span>
      <span className="text-ink-soft">{name}</span>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="border border-line rounded-lg p-3 bg-paper">
      <p className="text-[0.62rem] text-muted">{label}</p>
      <p className="text-lg font-black text-ink tabular-nums leading-tight mt-0.5">{value}</p>
    </div>
  );
}

function WorkListItem({ w, showRole }: { w: PersonWork; showRole?: boolean }) {
  return (
    <li className="flex items-center gap-3 py-2.5">
      <Link href={`/works/${w.workId}`} className="shrink-0">
        <WorkCover
          id={w.workId}
          title={w.title}
          url={w.posterUrl}
          className="w-10 h-14 rounded-md"
        />
      </Link>
      <div className="min-w-0 flex-1">
        <Link
          href={`/works/${w.workId}`}
          className="block text-sm font-bold text-ink hover:text-primary transition truncate"
        >
          {w.title}
        </Link>
        <p className="text-xs text-muted tabular-nums">
          {seasonLabel(w.seasonYear, w.seasonName)}
          {showRole && w.roleOrCharacter && (
            <span className="ml-2 text-ink-soft">{w.roleOrCharacter}</span>
          )}
        </p>
      </div>
      <span className="shrink-0 text-right w-14">
        <span className="block font-black text-accent tabular-nums">
          {w.score != null ? Math.round(w.score) : "—"}
        </span>
        <span className="block text-[0.6rem] text-muted">スコア</span>
      </span>
      {w.popularity != null && (
        <span className="shrink-0 text-right w-16 hidden sm:block">
          <span className="block text-xs font-bold text-ink-soft tabular-nums">
            {formatPopularity(w.popularity)}
          </span>
          <span className="block text-[0.6rem] text-muted">人気度</span>
        </span>
      )}
    </li>
  );
}

function CoList({ title, items }: { title: string; items: { name: string; count: number; type: "va" | "staff" }[] }) {
  return (
    <div>
      <h3 className="text-sm font-bold text-ink-soft mb-2">{title}</h3>
      <ul className="space-y-1">
        {items.map((item) => (
          <li key={item.name} className="flex items-center gap-2">
            <Link
              href={`/analytics/people/${item.type}/${encodeURIComponent(item.name)}`}
              className="text-sm text-primary hover:underline underline-offset-2 truncate min-w-0 flex-1"
            >
              {item.name}
            </Link>
            <span className="shrink-0 text-xs text-muted tabular-nums">{item.count}作品</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function YearStatChart({ data }: { data: PersonYearStat[] }) {
  if (data.length === 0) return null;
  if (data.length === 1) {
    const d = data[0];
    return (
      <p className="text-sm text-muted tabular-nums">
        {d.year}年: 平均{d.avgScore.toFixed(1)} / {d.works}本 / 打率{formatBa(d.battingAverage)}
      </p>
    );
  }

  const W = 480;
  const H = 120;
  const PAD_X = 28;
  const PAD_Y = 18;
  const scores = data.map((d) => d.avgScore);
  const minS = Math.min(...scores);
  const maxS = Math.max(...scores);
  const range = maxS - minS || 1;
  const px = (i: number) => PAD_X + (i / (data.length - 1)) * (W - PAD_X * 2);
  const py = (s: number) => PAD_Y + (1 - (s - minS) / range) * (H - PAD_Y * 2);
  const points = data.map((d, i) => `${px(i).toFixed(1)},${py(d.avgScore).toFixed(1)}`).join(" ");

  return (
    <div>
      <svg
        width="100%"
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label="年別平均スコアの推移"
        className="overflow-visible max-w-xl"
      >
        <polyline
          points={points}
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinejoin="round"
          strokeLinecap="round"
          className="text-accent"
        />
        {data.map((d, i) => (
          <g key={d.year}>
            <circle cx={px(i)} cy={py(d.avgScore)} r="3" className="fill-current text-accent" />
            <text
              x={px(i)}
              y={py(d.avgScore) - 8}
              textAnchor="middle"
              className="fill-current text-ink-soft"
              fontSize="11"
              fontWeight="700"
            >
              {d.avgScore.toFixed(1)}
            </text>
            <text
              x={px(i)}
              y={H - 2}
              textAnchor="middle"
              className="fill-current text-muted"
              fontSize="10"
            >
              {d.year}
            </text>
          </g>
        ))}
      </svg>
      {/* 年別詳細テーブル */}
      <div className="overflow-x-auto mt-3">
        <table className="text-xs border-collapse w-full max-w-sm">
          <thead>
            <tr className="text-[0.65rem] text-muted border-b border-line">
              <th className="text-left font-bold py-1 pr-3">年</th>
              <th className="text-center font-bold py-1 px-2">本数</th>
              <th className="text-center font-bold py-1 px-2">平均スコア</th>
              <th className="text-center font-bold py-1 px-2">打率</th>
            </tr>
          </thead>
          <tbody>
            {[...data].reverse().map((d) => (
              <tr key={d.year} className="border-b border-line/50">
                <td className="py-1 pr-3 text-ink-soft">{d.year}年</td>
                <td className="py-1 px-2 text-center tabular-nums text-ink-soft">{d.works}</td>
                <td className="py-1 px-2 text-center tabular-nums font-black text-accent">
                  {d.avgScore.toFixed(1)}
                </td>
                <td className="py-1 px-2 text-center tabular-nums font-bold text-ink">
                  {formatBa(d.battingAverage)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
