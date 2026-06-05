import { notFound } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";
import { getDataProvider } from "@/lib/data/provider";
import { WorkCover } from "@/components/WorkCover";
import { StatusBadge } from "@/components/StatusBadge";
import { AddToCalendar } from "@/components/AddToCalendar";
import { formatSeason } from "@/lib/season";
import { formatAirShort, formatWeekly } from "@/lib/format";
import { pickOnePerEpisode } from "@/lib/programs";

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

  // 系列局の同時ネットで同じ話数が並ぶため、1話1件（キー局代表）に整理
  const repPrograms = pickOnePerEpisode(work.programs.filter((p) => !p.isRebroadcast));
  const firstProgram = repPrograms[0] ?? work.programs[0] ?? null;
  const upcomingPrograms = repPrograms
    .filter((p) => new Date(p.startAt).getTime() >= Date.now() - 1000 * 60 * 60 * 24)
    .slice(0, 6);
  // 放送局数（代表局＋ほかN局の表示用）
  const channelCount = new Set(
    work.programs.filter((p) => p.channelName).map((p) => p.channelName),
  ).size;

  return (
    <div className="mx-auto max-w-5xl px-5 sm:px-8">
      {/* パンくず */}
      <div className="pt-6 text-xs text-muted">
        <Link href="/" className="hover:text-accent">
          一覧
        </Link>
        <span className="mx-1.5">/</span>
        <span className="text-ink-soft">{work.title}</span>
      </div>

      {/* ヘッダー */}
      <header className="grid grid-cols-1 sm:grid-cols-[200px_1fr] gap-7 sm:gap-9 pt-7 pb-10 border-b border-line">
        <WorkCover
          id={work.id}
          title={work.title}
          titleEn={work.titleEn}
          url={work.keyVisualUrl}
          className="aspect-[3/4] w-40 sm:w-full rounded-[var(--radius-card)] border border-line"
        />
        <div className="flex flex-col">
          <div className="flex items-center gap-3 flex-wrap">
            <StatusBadge status={work.status} />
            <span className="text-sm text-muted">{formatSeason(work.seasonYear, work.seasonName)}</span>
            {work.popularity > 0 && (
              <span className="text-sm text-muted" title="Annictのウォッチャー数">
                ♡ {work.popularity.toLocaleString("ja-JP")}
              </span>
            )}
          </div>
          <h1 className="display text-3xl sm:text-4xl leading-tight mt-3">{work.title}</h1>
          {work.titleEn && <p className="text-sm text-muted mt-1 tracking-wide">{work.titleEn}</p>}

          {work.genres.length > 0 && (
            <ul className="flex flex-wrap gap-2 mt-4">
              {work.genres.map((g) => (
                <li
                  key={g}
                  className="text-xs text-ink-soft border border-line-strong rounded-full px-3 py-0.5"
                >
                  {g}
                </li>
              ))}
            </ul>
          )}

          <div className="mt-auto pt-6 flex flex-wrap items-center gap-4">
            <AddToCalendar workId={work.id} workTitle={work.title} />
            {work.officialSiteUrl && (
              <a
                href={work.officialSiteUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm link-underline text-ink-soft"
              >
                公式サイト ↗
              </a>
            )}
          </div>
        </div>
      </header>

      {/* 本文 2カラム */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_300px] gap-10 lg:gap-14 py-10">
        <div className="space-y-12 min-w-0">
          {/* あらすじ */}
          {work.synopsis && (
            <Section title="あらすじ" en="Story">
              <p className="text-[0.97rem] leading-[2] text-ink-soft whitespace-pre-wrap">
                {work.synopsis}
              </p>
            </Section>
          )}

          {/* エピソード */}
          {work.episodes.length > 0 && (
            <Section title="エピソード" en="Episodes">
              <ul>
                {work.episodes.map((ep) => (
                  <li
                    key={ep.id}
                    className="rule-row flex gap-4 py-2.5 items-baseline last:border-b last:border-line"
                  >
                    <span className="display text-sm text-accent w-14 shrink-0 tabular-nums">
                      {ep.numberText ?? `#${ep.number ?? ""}`}
                    </span>
                    <span className="text-[0.92rem] text-ink-soft">
                      {ep.title ?? <span className="text-muted">（サブタイトル未定）</span>}
                    </span>
                  </li>
                ))}
              </ul>
            </Section>
          )}

          {/* キャスト */}
          {work.casts.length > 0 && (
            <Section title="キャスト" en="Cast">
              <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-8">
                {work.casts.map((c) => (
                  <div key={c.id} className="rule-row flex justify-between gap-3 py-2.5">
                    <dt className="text-[0.92rem] text-ink">{c.characterName}</dt>
                    <dd className="text-[0.92rem] text-ink-soft text-right">{c.personName}</dd>
                  </div>
                ))}
              </dl>
            </Section>
          )}

          {/* スタッフ */}
          {work.staff.length > 0 && (
            <Section title="スタッフ" en="Staff">
              <dl>
                {work.staff.map((s) => (
                  <div key={s.id} className="rule-row flex gap-4 py-2.5">
                    <dt className="text-[0.82rem] text-muted w-40 shrink-0">{s.role}</dt>
                    <dd className="text-[0.92rem] text-ink-soft">{s.personName}</dd>
                  </div>
                ))}
              </dl>
            </Section>
          )}
        </div>

        {/* サイド: 評価 + 放送情報 */}
        <aside className="lg:pt-1 space-y-5 lg:sticky lg:top-24">
          {(work.popularity > 0 || work.anilistScore != null || work.malScore != null) && (
            <div className="border border-line rounded-[var(--radius-card)] bg-surface p-5">
              <p className="kicker">評価・人気 / Ratings</p>
              <dl className="mt-3 space-y-3">
                {work.popularity > 0 && (
                  <div className="flex items-baseline justify-between">
                    <dt className="text-xs text-muted">国内人気<span className="text-[0.65rem]">（Annict）</span></dt>
                    <dd className="text-ink tabular-nums">
                      <span className="display text-lg">{work.popularity.toLocaleString()}</span>
                      <span className="text-xs text-muted"> 人</span>
                    </dd>
                  </div>
                )}
                {work.anilistScore != null && (
                  <div className="flex items-baseline justify-between">
                    <dt className="text-xs text-muted">海外スコア<span className="text-[0.65rem]">（AniList）</span></dt>
                    <dd className="text-ink tabular-nums">
                      <span className="display text-lg">{work.anilistScore}</span>
                      <span className="text-xs text-muted"> / 100</span>
                    </dd>
                  </div>
                )}
                {work.malScore != null && (
                  <div className="flex items-baseline justify-between">
                    <dt className="text-xs text-muted">MAL<span className="text-[0.65rem]">（{work.malScoredBy ? `${work.malScoredBy.toLocaleString()}件` : "世界"}）</span></dt>
                    <dd className="text-ink tabular-nums">
                      <span className="display text-lg">{work.malScore.toFixed(2)}</span>
                      <span className="text-xs text-muted"> / 10</span>
                    </dd>
                  </div>
                )}
              </dl>
            </div>
          )}

          <div className="border border-line rounded-[var(--radius-card)] bg-surface p-5">
            <p className="kicker">放送情報 / On air</p>
            <dl className="mt-3 space-y-3 text-sm">
              {firstProgram?.channelName && (
                <div>
                  <dt className="text-muted text-xs">放送局</dt>
                  <dd className="text-ink-soft mt-0.5">
                    {firstProgram.channelName}
                    {channelCount > 1 && (
                      <span className="text-muted"> ほか{channelCount - 1}局</span>
                    )}
                  </dd>
                </div>
              )}
              {firstProgram && (
                <div>
                  <dt className="text-muted text-xs">放送時間</dt>
                  <dd className="text-ink-soft mt-0.5">{formatWeekly(firstProgram.startAt)}</dd>
                </div>
              )}
            </dl>

            {upcomingPrograms.length > 0 && (
              <div className="mt-5 pt-5 border-t border-line">
                <p className="text-xs text-muted mb-2">直近の放送予定</p>
                <ul className="space-y-2">
                  {upcomingPrograms.map((p) => (
                    <li key={p.id} className="text-[0.82rem]">
                      <div className="flex justify-between gap-2">
                        <span className="text-ink-soft tabular-nums">{formatAirShort(p.startAt)}</span>
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

function Section({
  title,
  en,
  children,
}: {
  title: string;
  en: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <div className="flex items-baseline gap-3 mb-4">
        <h2 className="display text-xl text-ink">{title}</h2>
        <span className="kicker">{en}</span>
      </div>
      {children}
    </section>
  );
}
