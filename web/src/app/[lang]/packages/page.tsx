import { ArrowRight } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { AppButton } from "@/components/app-button";
import { EmptyNote, PackageCard, PageIntro, SectionHead, UnavailableNote } from "@/components/cards";
import { getSettings, publicGet, type Package, type Page } from "@/lib/api";
import { pageHref } from "@/lib/exam-filters";
import { digits } from "@/lib/format";
import { isLang, messages, translator, type Lang } from "@/lib/i18n";
import { alternates } from "@/lib/site";

export const revalidate = 60;

export async function generateMetadata({ params }: { params: Promise<{ lang: string }> }): Promise<Metadata> {
  const { lang } = await params;
  if (!isLang(lang)) return {};
  const t = translator(lang);
  return { title: t("meta.packagesTitle"), description: t("meta.packagesDescription"), alternates: alternates(lang, "/packages") };
}

/** Packages: every active package (price, validity, what it includes) and how buying
 * works. A student signs in on this website with the app account and pays on the provider's
 * secure page; the server verifies the payment and activates the package. The app only takes exams. */
export default async function PackagesPage({ params }: { params: Promise<{ lang: string }> }) {
  const lang = (await params).lang as Lang;
  const t = translator(lang);
  const how = messages(lang).packagesPage.how;
  const [packages, settings] = await Promise.all([publicGet<Page<Package>>("packages/?page_size=100", lang), getSettings(lang)]);
  const app = {
    downloadUrl: settings?.app_download_url ?? "",
    openUrl: settings?.app_open_url ?? "",
    labels: { download: t("app.download"), open: t("app.open"), soon: t("app.soon") },
    lang,
  };

  return (
    <>
      <PageIntro title={t("packagesPage.title")} body={t("packagesPage.body")} />
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <section aria-label={t("packagesPage.title")}>
          {packages === null ? (
            <UnavailableNote text={t("packagesPage.unavailable")} />
          ) : packages.results.length ? (
            <ul className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {packages.results.map((pkg) => (
                <li key={pkg.slug}>
                  <PackageCard pkg={pkg} lang={lang} />
                </li>
              ))}
            </ul>
          ) : (
            <EmptyNote text={t("home.packages.empty")} />
          )}
          <div className="mt-6 flex flex-wrap items-center gap-x-6 gap-y-3">
            <Link href={`/${lang}/account/buy`} className="inline-flex min-h-11 items-center justify-center rounded-control bg-brand-600 px-5 font-semibold text-white hover:bg-brand-700">
              {t("packagesPage.buyCta")}
            </Link>
            <Link href={pageHref(lang, { access: "paid" })} className="inline-flex items-center gap-1 font-semibold text-brand-700 hover:underline">
              {t("packagesPage.paidExams")}
              <ArrowRight className="size-4" aria-hidden />
            </Link>
          </div>
        </section>

        <section aria-labelledby="how-buy" className="mt-16">
          <SectionHead id="how-buy" title={how.title} />
          <ol className="mt-8 grid gap-4 md:grid-cols-3">
            {how.steps.map((step, index) => (
              <li key={step.title} className="rounded-card border border-line bg-surface p-6">
                <span className="flex size-10 items-center justify-center rounded-full bg-brand-600 text-lg font-bold text-white">{digits(index + 1, lang)}</span>
                <h3 className="mt-4 font-semibold text-ink">{step.title}</h3>
                <p className="mt-1 text-sm text-ink-muted">{step.body}</p>
              </li>
            ))}
          </ol>
          <AppButton {...app} size="lg" className="mt-8" />
        </section>
      </div>
    </>
  );
}
