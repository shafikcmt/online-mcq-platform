import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { PageIntro } from "@/components/cards";
import { LegalBody } from "@/components/legal-page";
import { publicFetch, type CmsPage } from "@/lib/api";
import { isLang, messages, translator, type Lang } from "@/lib/i18n";
import { alternates } from "@/lib/site";

export const revalidate = 60;

export async function generateMetadata({ params }: { params: Promise<{ lang: string }> }): Promise<Metadata> {
  const { lang } = await params;
  if (!isLang(lang)) return {};
  const t = translator(lang);
  return { title: t("meta.privacyTitle"), description: t("meta.privacyDescription"), alternates: alternates(lang, "/privacy") };
}

/** The privacy page: our own text, or the page of this name written in Admin Panel → Pages. */
export default async function PrivacyPage({ params }: { params: Promise<{ lang: string }> }) {
  const { lang: raw } = await params;
  if (!isLang(raw)) notFound();
  const lang = raw as Lang;
  const legal = messages(lang).legal;
  const fetched = await publicFetch<CmsPage>("pages/privacy/", lang);
  const page = fetched.state === "ok" ? fetched.data : null;
  return (
    <>
      <PageIntro title={page?.title || legal.privacy.title} />
      <div className="mx-auto max-w-6xl px-4 pb-16 sm:px-6">
        <LegalBody legal={legal.privacy} updated={legal.updated} page={page} lang={lang} />
      </div>
    </>
  );
}
