import { MessageCircleQuestion } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { EmptyNote, PageIntro, UnavailableNote } from "@/components/cards";
import { publicGet, type Faq, type Page } from "@/lib/api";
import { isLang, translator, type Lang } from "@/lib/i18n";
import { alternates } from "@/lib/site";

export const revalidate = 60;

export async function generateMetadata({ params }: { params: Promise<{ lang: string }> }): Promise<Metadata> {
  const { lang } = await params;
  if (!isLang(lang)) return {};
  const t = translator(lang);
  return { title: t("meta.faqTitle"), description: t("meta.faqDescription"), alternates: alternates(lang, "/faq") };
}

/** FAQ: every active question in the admin's order, as native disclosure widgets (keyboard
 * and screen-reader friendly without JavaScript), plus FAQPage structured data. */
export default async function FaqPage({ params }: { params: Promise<{ lang: string }> }) {
  const lang = (await params).lang as Lang;
  const t = translator(lang);
  const faqs = await publicGet<Page<Faq>>("faqs/?page_size=100", lang);
  const items = faqs?.results ?? [];
  // JSON in a <script> tag: escape "<" so no text can close the tag early.
  const structured = JSON.stringify({
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: items.map((faq) => ({ "@type": "Question", name: faq.question, acceptedAnswer: { "@type": "Answer", text: faq.answer } })),
  }).replace(/</g, "\\u003c");

  return (
    <>
      <PageIntro title={t("faqPage.title")} body={t("faqPage.body")} />
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <div className="max-w-3xl">
          {faqs === null ? (
            <UnavailableNote text={t("faqPage.unavailable")} />
          ) : items.length === 0 ? (
            <EmptyNote text={t("faqPage.empty")} />
          ) : (
            <>
              <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: structured }} />
              <div className="divide-y divide-line rounded-card border border-line bg-surface shadow-sm">
                {items.map((faq) => (
                  <details key={faq.question} className="group p-5">
                    <summary className="cursor-pointer list-none font-semibold text-ink marker:hidden">
                      <span className="flex items-center justify-between gap-4">
                        {faq.question}
                        <span aria-hidden className="text-xl text-brand-700 transition-transform group-open:rotate-45">
                          +
                        </span>
                      </span>
                    </summary>
                    <p className="mt-3 whitespace-pre-line leading-relaxed text-ink-muted">{faq.answer}</p>
                  </details>
                ))}
              </div>
            </>
          )}
          <div className="mt-10 flex flex-wrap items-center gap-3 rounded-card bg-brand-50 p-5">
            <MessageCircleQuestion className="size-6 text-brand-700" aria-hidden />
            <p className="font-semibold text-brand-950">{t("faqPage.more")}</p>
            <Link href={`/${lang}/contact`} className="ml-auto inline-flex min-h-11 items-center rounded-control bg-brand-600 px-4 font-semibold text-white hover:bg-brand-700">
              {t("faqPage.contact")}
            </Link>
          </div>
        </div>
      </div>
    </>
  );
}
