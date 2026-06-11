export const dynamic = "force-dynamic";
import { notFound } from "next/navigation";
import { cookies } from "next/headers";
import Link from "next/link";
import type { Metadata } from "next";
import { getDataProvider } from "@/lib/data/provider";
import { WorkCover } from "@/components/WorkCover";
import { StatusBadge } from "@/components/StatusBadge";
import { SubscribeButton } from "@/components/SubscribeButton";
import { formatSeason } from "@/lib/season";
import { formatAirShort, formatWeekly } from "@/lib/format";
import { pickOnePerEpisode } from "@/lib/programs";
import { parseRegion, REGION_COOKIE } from "@/lib/regions";
import {
  parseChannelsCookie,
  seedChannelsFromRegion,
  CHANNELS_COOKIE,
} from "@/lib/channels";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const work = await (await getDataProvider()).getWork(id);
  if (!work) return { title: "作品が見つかりません" };
  return {
    title: work.title,
    description: work.synopsis?.slice(0, 100) ?? undefined,
  };
}

export default async function WorkDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const work = await (await getDataProvider()).getWork(id);
  if (!work) notFound();

  // 放送局選択を Cookie から取得。未設定なら（レガシー）地域の種から既定セットを使う。
  const cookieStore = await cookies();
  const cookieChannels = parseChannelsCookie(cookieStore.get(CHANNELS_COOKIE)?.value);
  const channels =
    cookieChannels.length > 0
      ? cookieChannels
      : seedChannelsFromRegion(parseRegion(cookieStore.get(REGION_COOKIE)?.value));

  // 系列局の同時ネットで同じ話数が並ぶため、1話1件（選択局の代表）に整理
  const repPrograms = pickOnePerEpisode(work.programs.filter((p) => !p.isRebroadcast), channels);
  const firstProgram = repPrograms[0] ?? work.programs[0] ?? null;
  const upcomingPrograms = repPrograms
    .filter((p) => new Date(p.startAt).getTime() >= Date.now() - 1000 * 60 * 60 * 24)
    .slice(0, 6);
  const channelCount = new Set(
    work.programs.filter((p) => p.channelName).map((p) => p.channelName),
  ).size;

  return (
    <div className="mx-auto max-w-6xl px-4 sm:px-6">
      {/* パンくず */}
      <div className="pt-4 text-xs text-muted">
        <Link href="/" className="hover:text-primary">
          作品一覧
        </Link>
        <span className="mx-1.5">›</span>
        <span className="text-ink-soft">{work.title}</span>
      </div>

      {/* ヘッダーカード */}
      <header className="card mt-3 p-5 sm:p-7 grid grid-cols-1 sm:grid-cols-[190px_1fr] gap-6 sm:gap-8">
        <WorkCover
          id={work.id}
          title={work.title}
          titleEn={work.titleEn}
          url={work.keyVisualUrl}
          className="aspect-[3/4] w-44 sm:w-full rounded-lg"
        />
        <div className="flex flex-col min-w-0">
          <div className="flex items-center gap-2.5 flex-wrap">
            <StatusBadge status={work.status} />
            <span className="text-sm text-muted font-medium">
              {formatSeason(work.seasonYear, work.seasonName)}
            </span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-black leading-snug mt-2.5">{work.title}</h1>
          {work.titleEn && <p className="text-sm text-muted mt-1">{work.titleEn}</p>}

          {work.genres.length > 0 && (
            <ul className="flex flex-wrap gap-1.5 mt-3.5">
              {work.genres.map((g) => (
                <li
                  key={g}
                  className="text-xs font-medium text-ink-soft bg-paper rounded-full px-3 py-1"
                >
                  {g}
                </li>
              ))}
            </ul>
          )}

          {/* 評価バー */}
          {(work.popularity > 0 || work.anilistScore != null || work.malScore != null) && (
            <div className="flex flex-wrap gap-x-7 gap-y-2 mt-5">
              {work.popularity > 0 && (
                <Metric label="国内人気（Annict）" value={work.popularity.toLocaleString()} unit="人" />
              )}
              {work.anilistScore != null && (
                <Metric label="AniList" value={String(work.anilistScore)} unit="/100" />
              )}
              {work.malScore != null && (
                <Metric label="MyAnimeList" value={work.malScore.toFixed(2)} unit="/10" />
              )}
            </div>
          )}

          <div className="mt-auto pt-6 flex flex-wrap items-center gap-4">
            <SubscribeButton
              workId={work.id}
              workTitle={work.title}
              channels={work.programs.map((p) => p.channelName)}
            />
            {work.officialSiteUrl && (
              <a
                href={work.officialSiteUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm font-bold text-primary hover:underline underline-offset-2"
              >
                公式サイト ↗
              </a>
            )}
          </div>
        </div>
      </header>

      {/* 本文 2カラム */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_300px] gap-5 py-5">
        <div className="space-y-5 min-w-0">
          {/* あらすじ */}
          {work.synopsis && (
            <section className="card p-5 sm:p-6">
              <h2 className="section-title text-lg mb-3">あらすじ</h2>
              <p className="text-[0.95rem] leading-[1.9] text-ink-soft whitespace-pre-wrap">
                {work.synopsis}
              </p>
            </section>
          )}

          {/* 詳細分析への導線（分析は詳細分析ページに集約） */}
          <Link
            href={`/analytics/works/${work.id}`}
            className="card p-5 sm:p-6 flex items-center gap-4 hover:border-primary/40 transition group"
          >
            <div className="flex-1 min-w-0">
              <h2 className="text-base font-black text-accent">この作品の詳細分析</h2>
              <p className="text-xs text-muted mt-1 leading-relaxed">
                ニコニコ実況の盛り上がり・継続率・話ごとの評価、Xの反応（X
                Premium・x_search）、クール内ポジションなどをまとめて見られます。
              </p>
            </div>
            <span className="text-sm font-bold text-primary whitespace-nowrap group-hover:translate-x-0.5 transition-transform">
              詳細分析ページへ →
            </span>
          </Link>

          {/* エピソード */}
          {work.episodes.length > 0 && (
            <section className="card p-5 sm:p-6">
              <h2 className="section-title text-lg mb-3">エピソード</h2>
              <ul>
                {work.episodes.map((ep) => (
                  <li
                    key={ep.id}
                    className="rule-row flex gap-4 py-2.5 items-baseline last:border-b last:border-line"
                  >
                    <span className="font-bold text-sm text-primary w-14 shrink-0 tabular-nums">
                      {ep.numberText ?? `#${ep.number ?? ""}`}
                    </span>
                    <span className="text-[0.9rem] text-ink-soft">
                      {ep.title ?? <span className="text-muted">（サブタイトル未定）</span>}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* キャスト */}
          {work.casts.length > 0 && (
            <section className="card p-5 sm:p-6">
              <h2 className="section-title text-lg mb-3">キャスト</h2>
              <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-8">
                {work.casts.map((c) => (
                  <div key={c.id} className="rule-row flex justify-between gap-3 py-2.5">
                    <dt className="text-[0.9rem] font-medium text-ink">{c.characterName}</dt>
                    <dd className="text-[0.9rem] text-ink-soft text-right">
                      <Link
                        href={`/analytics/people/va/${encodeURIComponent(c.personName)}`}
                        className="hover:text-primary hover:underline underline-offset-2"
                      >
                        {c.personName}
                      </Link>
                    </dd>
                  </div>
                ))}
              </dl>
            </section>
          )}

          {/* スタッフ */}
          {work.staff.length > 0 && (
            <section className="card p-5 sm:p-6">
              <h2 className="section-title text-lg mb-3">スタッフ</h2>
              <dl>
                {work.staff.map((s) => (
                  <div key={s.id} className="rule-row flex gap-4 py-2.5">
                    <dt className="text-[0.8rem] text-muted w-40 shrink-0">{s.role}</dt>
                    <dd className="text-[0.9rem] text-ink-soft">
                      <Link
                        href={`/analytics/people/staff/${encodeURIComponent(s.personName)}`}
                        className="hover:text-primary hover:underline underline-offset-2"
                      >
                        {s.personName}
                      </Link>
                    </dd>
                  </div>
                ))}
              </dl>
            </section>
          )}
        </div>

        {/* サイド: 放送情報 */}
        <aside className="space-y-5 lg:sticky lg:top-20 self-start w-full">
          <div className="card p-5">
            <h2 className="section-title text-base mb-3">放送情報</h2>
            <dl className="space-y-3 text-sm">
              {firstProgram?.channelName && (
                <div>
                  <dt className="text-muted text-xs font-medium">放送局</dt>
                  <dd className="text-ink mt-0.5 font-medium">
                    {firstProgram.channelName}
                    {channelCount > 1 && (
                      <span className="text-muted font-normal"> ほか{channelCount - 1}局</span>
                    )}
                  </dd>
                </div>
              )}
              {firstProgram && (
                <div>
                  <dt className="text-muted text-xs font-medium">放送時間</dt>
                  <dd className="text-ink mt-0.5 font-medium">{formatWeekly(firstProgram.startAt)}</dd>
                </div>
              )}
            </dl>

            {upcomingPrograms.length > 0 && (
              <div className="mt-4 pt-4 border-t border-line">
                <p className="text-xs font-bold text-muted mb-2">直近の放送予定</p>
                <ul className="space-y-2">
                  {upcomingPrograms.map((p) => (
                    <li key={p.id} className="text-[0.82rem]">
                      <div className="flex justify-between gap-2">
                        <span className="text-ink font-medium tabular-nums">{formatAirShort(p.startAt)}</span>
                        {p.count != null && <span className="text-muted">第{p.count}話</span>}
                      </div>
                      {p.channelName && (
                        <div className="text-[0.72rem] text-muted truncate">{p.channelName}</div>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}

function Metric({ label, value, unit }: { label: string; value: string; unit: string }) {
  return (
    <div>
      <p className="text-[0.68rem] text-muted font-medium">{label}</p>
      <p className="text-ink tabular-nums">
        <span className="text-xl font-black">{value}</span>
        <span className="text-xs text-muted ml-0.5">{unit}</span>
      </p>
    </div>
  );
}
