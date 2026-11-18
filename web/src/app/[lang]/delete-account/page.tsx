import { ArrowRight } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { PageIntro } from "@/components/cards";
import { isLang, messages, translator, type Lang } from "@/lib/i18n";
import { alternates } from "@/lib/site";

export const revalidate = 3600;

export async function generateMetadata({ params }: { params: Promise<{ lang: string }> }): Promise<Metadata> {
  const { lang } = await params;
  if (!isLang(lang)) return {};
  const t = translator(lang);
  return { title: t("meta.deleteAccountTitle"), description: t("meta.deleteAccountDescription"), alternates: alternates(lang, "/delete-account") };
}

/** How a student deletes their account and what that means. Google Play asks for a public page like this one;
 * the steps are the app's own (Profile → Delete account), with a contact route for anyone who cannot sign in. */
export default async function DeleteAccountPage({ params }: { params: Promise<{ lang: string }> }) {
  const { lang: raw } = await params;
  if (!isLang(raw)) notFound();
  const lang = raw as Lang;
  const t = translator(lang);
  const m = messages(lang).legal.deleteAccount;
  const blocks = [
    { title: m.appTitle, body: m.appSteps },
    { title: m.forgotTitle, body: m.forgot },
    { title: m.erasedTitle, body: m.erased },
    { title: m.keptTitle, body: m.kept },
    { title: m.noAppTitle, body: m.noApp },
  ];
  const link = "inline-flex min-h-11 items-center gap-1 rounded-control border border-line bg-surface px-4 font-semibold text-brand-700 hover:border-brand-600";
  return (
    <>
      <PageIntro title={m.title} body={m.intro} />
      <div className="mx-auto max-w-6xl px-4 pb-16 sm:px-6">
        <article className="max-w-3xl">
          {blocks.map((block, index) => (
            <section key={block.title} aria-labelledby={`delete-${index}`} className={index ? "mt-8" : ""}>
              <h2 id={`delete-${index}`} className="text-xl font-semibold text-ink">
                {block.title}
              </h2>
              <p className="mt-2 whitespace-pre-line leading-relaxed text-ink">{block.body}</p>
            </section>
          ))}
          <div className="mt-10 flex flex-wrap gap-3">
            <Link href={`/${lang}/contact`} className={link}>
              {m.contact}
              <ArrowRight className="size-4" aria-hidden />
            </Link>
            <Link href={`/${lang}/privacy`} className={link}>
              {m.privacy}
              <ArrowRight className="size-4" aria-hidden />
            </Link>
          </div>
          <p className="mt-8 text-sm text-ink-subtle">{t("legal.updated")}</p>
        </article>
      </div>
    </>
  );
}
