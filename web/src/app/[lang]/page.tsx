import { ArrowRight, BadgeCheck, BarChart3, BookOpenCheck, Briefcase, Building2, Clock3, Download, GraduationCap, Landmark, Languages, ListChecks, ShieldCheck, Stethoscope, Trophy } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { AppButton } from "@/components/app-button";
import { EmptyNote, ExamCard, NoticeItem, PackageCard, SectionHead } from "@/components/cards";
import { PhoneMock } from "@/components/phone-mock";
import { Spotlight, type SpotlightState } from "@/components/spotlight";
import { getSettings, publicGet, type Category, type Exam, type Faq, type Notice, type Package, type Page } from "@/lib/api";
import { digits } from "@/lib/format";
import { isLang, messages, translator, type Lang } from "@/lib/i18n";
import { alternates } from "@/lib/site";

export const revalidate = 60;

export async function generateMetadata({ params }: { params: Promise<{ lang: string }> }): Promise<Metadata> {
  const { lang } = await params;
  if (!isLang(lang)) return {};
  const t = translator(lang);
  return { title: { absolute: t("meta.homeTitle") }, description: t("meta.homeDescription"), alternates: alternates(lang, "") };
}

const FEATURE_ICONS = [ListChecks, Clock3, Trophy, BadgeCheck, Languages, ShieldCheck];
/** Neutral icons in turn (categories are admin-defined, so no icon is tied to a name). */
const CATEGORY_ICONS = [GraduationCap, Stethoscope, BookOpenCheck, Landmark, Building2, Briefcase];

/** Home: what Live Model Test is, live data from the public API (upcoming / open exams,
 * packages, notices, FAQs) and the way to the app, where exams are taken. */
export default async function HomePage({ params }: { params: Promise<{ lang: string }> }) {
  const { lang: raw } = await params;
  const lang = raw as Lang;
  const t = translator(lang);
  const m = messages(lang).home;
  const [settings, upcoming, all, packages, notices, faqs, categories] = await Promise.all([
    getSettings(lang),
    publicGet<Page<Exam>>("exams/?upcoming=true&page_size=3", lang),
    publicGet<Page<Exam>>("exams/?page_size=12", lang),
    publicGet<Page<Package>>("packages/?page_size=3", lang),
    publicGet<Page<Notice>>("announcements/?page_size=3", lang),
    publicGet<Page<Faq>>("faqs/?page_size=4", lang),
    publicGet<Page<Category>>("categories/?page_size=20", lang),
  ]);
  const now = Date.now();
  const open = (all?.results ?? []).filter((exam) => (!exam.start_at || Date.parse(exam.start_at) <= now) && (!exam.end_at || Date.parse(exam.end_at) > now)).slice(0, 3);
  // The featured exam: a live exam open now, else any open exam, else the next upcoming one.
  const live = open.find((exam) => exam.exam_type === "live");
  const spotlight: { exam: Exam; state: SpotlightState } | null = live
    ? { exam: live, state: "live" }
    : open[0]
      ? { exam: open[0], state: "open" }
      : upcoming?.results[0]
        ? { exam: upcoming.results[0], state: "upcoming" }
        : null;
  const shownCategories = (categories?.results ?? []).filter((category) => category.exam_count > 0).slice(0, 6);
  const app = {
    downloadUrl: settings?.app_download_url ?? "",
    openUrl: settings?.app_open_url ?? "",
    labels: { download: t("app.download"), open: t("app.open"), soon: t("app.soon") },
    lang,
  };

  return (
    <>
      {/* Hero */}
      <section className="relative overflow-hidden bg-gradient-to-b from-brand-50 to-canvas">
        <div className="mx-auto grid max-w-6xl items-center gap-12 px-4 py-14 sm:px-6 lg:grid-cols-[1.15fr_1fr] lg:py-20">
          <div className="flex flex-col gap-5">
            <p className="text-sm font-semibold uppercase tracking-wide text-brand-700">{m.hero.eyebrow}</p>
            <h1 className="text-4xl font-bold tracking-tight text-brand-950 sm:text-5xl">{settings?.tagline ? settings.tagline : m.hero.title}</h1>
            <p className="max-w-xl text-lg text-ink-muted">{m.hero.body}</p>
            <div className="flex flex-wrap items-center gap-3">
              <AppButton {...app} size="lg" />
              <a href="#how" className="inline-flex min-h-12 items-center rounded-control px-4 font-semibold text-brand-700 hover:bg-brand-50">
                {m.hero.secondary}
              </a>
            </div>
          </div>
          <PhoneMock lang={lang} />
        </div>
      </section>

      {/* Featured exam (live / open now / next) */}
      {spotlight ? (
        <section aria-label={m.spotlight.label} className="mx-auto -mt-6 max-w-6xl px-4 sm:px-6 lg:-mt-10">
          <Spotlight exam={spotlight.exam} state={spotlight.state} lang={lang} />
        </section>
      ) : null}

      {/* Exam categories (only those with exams) */}
      {shownCategories.length ? (
        <section aria-labelledby="categories" className="mx-auto max-w-6xl px-4 pt-16 sm:px-6">
          <SectionHead id="categories" title={m.categories.title} body={m.categories.body} />
          <ul className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {shownCategories.map((category, index) => {
              const Icon = CATEGORY_ICONS[index % CATEGORY_ICONS.length];
              return (
                <li key={category.slug}>
                  <Link
                    href={`/${lang}/exams?category=${category.slug}`}
                    className="group flex items-center gap-4 rounded-[1rem] border border-line bg-surface p-4 shadow-sm transition hover:-translate-y-0.5 hover:border-brand-600 hover:shadow-md focus-visible:outline-2 focus-visible:outline-brand-600"
                  >
                    <span className="flex size-12 shrink-0 items-center justify-center rounded-card bg-brand-50 text-brand-600 transition group-hover:bg-brand-600 group-hover:text-white">
                      <Icon className="size-6" aria-hidden />
                    </span>
                    <span className="flex min-w-0 flex-col">
                      <span className="font-semibold text-ink">{category.name}</span>
                      <span className="text-sm text-ink-muted">{t("home.categories.exams", { n: digits(category.exam_count, lang) })}</span>
                    </span>
                    <ArrowRight className="ml-auto size-4 shrink-0 text-ink-subtle transition group-hover:text-brand-600" aria-hidden />
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      {/* Features */}
      <section aria-labelledby="features" className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
        <SectionHead id="features" title={m.features.title} />
        <ul className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {m.features.items.map((item, index) => {
            const Icon = FEATURE_ICONS[index] ?? BarChart3;
            return (
              <li key={item.title} className="rounded-card border border-line bg-surface p-6 shadow-sm">
                <span className="flex size-11 items-center justify-center rounded-full bg-brand-50 text-brand-700">
                  <Icon className="size-6" aria-hidden />
                </span>
                <h3 className="mt-4 font-semibold text-ink">{item.title}</h3>
                <p className="mt-1 text-sm text-ink-muted">{item.body}</p>
              </li>
            );
          })}
        </ul>
      </section>

      {/* Exams */}
      <section aria-labelledby="exams" className="bg-surface py-16">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <SectionHead id="exams" title={m.exams.title} />
          {[
            { key: "open", title: m.exams.open, items: open },
            { key: "upcoming", title: m.exams.upcoming, items: upcoming?.results ?? [] },
          ].map((group) =>
            group.items.length ? (
              <div key={group.key} className="mt-8">
                <h3 className="text-lg font-semibold text-ink">{group.title}</h3>
                <ul className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {group.items.map((exam) => (
                    <li key={exam.slug}>
                      <ExamCard exam={exam} lang={lang} />
                    </li>
                  ))}
                </ul>
              </div>
            ) : null,
          )}
          {!open.length && !upcoming?.results.length ? (
            <div className="mt-8">
              <EmptyNote text={m.exams.empty} />
            </div>
          ) : null}
          <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
            <p className="flex items-center gap-2 text-sm font-medium text-brand-700">
              <Download className="size-4" aria-hidden />
              {m.exams.cta}
            </p>
            <SeeAll href={`/${lang}/exams`} label={m.exams.all} />
          </div>
        </div>
      </section>

      {/* Packages */}
      <section aria-labelledby="packages" className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
        <SectionHead id="packages" title={m.packages.title} body={m.packages.body} />
        {packages?.results.length ? (
          <ul className="mt-8 grid gap-4 md:grid-cols-3">
            {packages.results.map((pkg) => (
              <li key={pkg.slug}>
                <PackageCard pkg={pkg} lang={lang} />
              </li>
            ))}
          </ul>
        ) : (
          <div className="mt-8">
            <EmptyNote text={m.packages.empty} />
          </div>
        )}
        <div className="mt-6 flex justify-end">
          <SeeAll href={`/${lang}/packages`} label={m.packages.all} />
        </div>
      </section>

      {/* Notices */}
      <section aria-labelledby="notices" className="bg-surface py-16">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <SectionHead id="notices" title={m.notices.title} />
          {notices?.results.length ? (
            <ul className="mt-8 grid gap-4 md:grid-cols-3">
              {notices.results.map((notice) => (
                <li key={`${notice.published_at}-${notice.title}`}>
                  <NoticeItem notice={notice} lang={lang} />
                </li>
              ))}
            </ul>
          ) : (
            <div className="mt-8">
              <EmptyNote text={m.notices.empty} />
            </div>
          )}
          {notices?.results.length ? (
            <div className="mt-6 flex justify-end">
              <SeeAll href={`/${lang}/notices`} label={m.notices.all} />
            </div>
          ) : null}
        </div>
      </section>

      {/* How it works */}
      <section aria-labelledby="how" className="mx-auto max-w-6xl scroll-mt-20 px-4 py-16 sm:px-6">
        <SectionHead id="how" title={m.how.title} />
        <ol className="mt-8 grid gap-4 md:grid-cols-3">
          {m.how.steps.map((step, index) => (
            <li key={step.title} className="rounded-card border border-line bg-surface p-6">
              <span className="flex size-10 items-center justify-center rounded-full bg-brand-600 text-lg font-bold text-white">{digits(index + 1, lang)}</span>
              <h3 className="mt-4 font-semibold text-ink">{step.title}</h3>
              <p className="mt-1 text-sm text-ink-muted">{step.body}</p>
            </li>
          ))}
        </ol>
      </section>

      {/* FAQ preview (only when the admin has published FAQs) */}
      {faqs?.results.length ? (
        <section aria-labelledby="faq" className="bg-surface py-16">
          <div className="mx-auto max-w-3xl px-4 sm:px-6">
            <SectionHead id="faq" title={m.faq.title} />
            <div className="mt-6 divide-y divide-line rounded-card border border-line">
              {faqs.results.map((faq) => (
                <details key={faq.question} className="group p-5">
                  <summary className="cursor-pointer list-none font-semibold text-ink marker:hidden">
                    <span className="flex items-center justify-between gap-4">
                      {faq.question}
                      <span aria-hidden className="text-brand-700 transition-transform group-open:rotate-45">+</span>
                    </span>
                  </summary>
                  <p className="mt-2 whitespace-pre-line text-sm text-ink-muted">{faq.answer}</p>
                </details>
              ))}
            </div>
          </div>
        </section>
      ) : null}

      {/* Get the app */}
      <section id="get-app" aria-labelledby="final" className="mx-auto max-w-6xl scroll-mt-20 px-4 pt-16 sm:px-6">
        <div className="flex flex-col items-start gap-5 rounded-dialog bg-gradient-to-br from-brand-700 to-brand-950 p-8 text-white sm:p-12 md:flex-row md:items-center md:justify-between">
          <div className="max-w-xl">
            <h2 id="final" className="text-2xl font-bold sm:text-3xl">
              {m.final.title}
            </h2>
            <p className="mt-2 text-brand-100">{settings?.app_download_url ? m.final.body : t("app.soonBody")}</p>
          </div>
          <AppButton {...app} size="lg" className="bg-white text-brand-800 hover:bg-brand-50" />
        </div>
      </section>
    </>
  );
}

function SeeAll({ href, label }: { href: string; label: string }) {
  return (
    <Link href={href} className="inline-flex min-h-11 items-center gap-1 rounded-control px-3 font-semibold text-brand-700 hover:bg-brand-50">
      {label}
      <ArrowRight className="size-4" aria-hidden />
    </Link>
  );
}
