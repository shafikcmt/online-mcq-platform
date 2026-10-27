import type { Metadata } from "next";

import { Chip, EmptyNote, PageIntro, UnavailableNote } from "@/components/cards";
import { Pager, pageParam } from "@/components/pager";
import { publicFetch, type Notice, type Page } from "@/lib/api";
import { date } from "@/lib/format";
import { isLang, translator, type Lang } from "@/lib/i18n";
import { alternates } from "@/lib/site";

const PAGE_SIZE = 10;

type Props = { params: Promise<{ lang: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const { lang } = await params;
  if (!isLang(lang)) return {};
  const t = translator(lang);
  const page = pageParam((await searchParams).page);
  return {
    title: t("meta.noticesTitle"),
    description: t("meta.noticesDescription"),
    alternates: alternates(lang, "/notices"),
    robots: page > 1 ? { index: false, follow: true } : undefined,
  };
}

/** Notices for the website (audience "public" or "everyone"), pinned first, newest
 * first, with their full text. Expired notices are never returned by the API. */
export default async function NoticesPage({ params, searchParams }: Props) {
  const lang = (await params).lang as Lang;
  const t = translator(lang);
  const page = pageParam((await searchParams).page);
  const fetched = await publicFetch<Page<Notice>>(`announcements/?page=${page}&page_size=${PAGE_SIZE}`, lang);
  const list = fetched.state === "ok" ? fetched.data : fetched.state === "missing" ? { count: 0, next: null, previous: null, results: [] } : null;

  return (
    <>
      <PageIntro title={t("notices.title")} body={t("notices.body")} />
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <div className="max-w-3xl">
        {list === null ? (
          <UnavailableNote text={t("notices.unavailable")} />
        ) : list.results.length === 0 ? (
          <EmptyNote text={t("notices.empty")} />
        ) : (
          <ol className="flex flex-col gap-4">
            {list.results.map((notice) => (
              <li key={`${notice.published_at}-${notice.title}`}>
                <article className="rounded-card border border-line bg-surface p-6 shadow-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    {notice.is_pinned ? <Chip tone="accent">{t("pinned")}</Chip> : null}
                    <time dateTime={notice.published_at} className="text-sm text-ink-subtle">
                      {date(notice.published_at, lang)}
                    </time>
                  </div>
                  <h2 className="mt-2 text-lg font-semibold text-ink">{notice.title}</h2>
                  <p className="mt-2 whitespace-pre-line leading-relaxed text-ink-muted">{notice.body}</p>
                </article>
              </li>
            ))}
          </ol>
        )}
        {list ? <Pager lang={lang} t={t} page={page} pages={Math.max(1, Math.ceil(list.count / PAGE_SIZE))} href={(n) => `/${lang}/notices${n > 1 ? `?page=${n}` : ""}`} /> : null}
        </div>
      </div>
    </>
  );
}
