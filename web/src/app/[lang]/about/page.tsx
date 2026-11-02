import { ArrowRight } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { PageIntro } from "@/components/cards";
import { publicFetch, type CmsPage } from "@/lib/api";
import { date } from "@/lib/format";
import { isLang, translator, type Lang } from "@/lib/i18n";
import { alternates } from "@/lib/site";

export const revalidate = 60;

export async function generateMetadata({ params }: { params: Promise<{ lang: string }> }): Promise<Metadata> {
  const { lang } = await params;
  if (!isLang(lang)) return {};
  const t = translator(lang);
  return { title: t("meta.aboutTitle"), description: t("meta.aboutDescription"), alternates: alternates(lang, "/about") };
}

/** About: the "about" page written in the Admin Panel → Pages. Until an admin publishes
 * one (or while the API is briefly unavailable) the site shows its own short text, so the
 * page is never empty. CMS text is plain text, shown as written (never as HTML). */
export default async function AboutPage({ params }: { params: Promise<{ lang: string }> }) {
  const lang = (await params).lang as Lang;
  const t = translator(lang);
  const fetched = await publicFetch<CmsPage>("pages/about/", lang);
  const page = fetched.state === "ok" ? fetched.data : null;

  return (
    <>
      <PageIntro title={page?.title || t("about.title")} />
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <article className="max-w-3xl">
          <p className="whitespace-pre-line text-lg leading-relaxed text-ink">{page?.body || t("about.fallback")}</p>
          {page ? (
            <p className="mt-6 text-sm text-ink-subtle">
              {t("about.updated", { date: date(page.updated_at, lang) })}
            </p>
          ) : null}
          <div className="mt-10 flex flex-wrap gap-3">
            {(["exams", "leaderboard", "contact"] as const).map((key) => (
              <Link key={key} href={`/${lang}/${key}`} className="inline-flex min-h-11 items-center gap-1 rounded-control border border-line bg-surface px-4 font-semibold text-brand-700 hover:border-brand-600">
                {t(`nav.${key}`)}
                <ArrowRight className="size-4" aria-hidden />
              </Link>
            ))}
          </div>
        </article>
      </div>
    </>
  );
}
