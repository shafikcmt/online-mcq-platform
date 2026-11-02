import type { Metadata, Viewport } from "next";
import { notFound } from "next/navigation";

import { SiteFooter, SiteHeader } from "@/components/site-chrome";
import { getSettings } from "@/lib/api";
import { bengali, inter } from "@/lib/fonts";
import { isLang, LANGS, translator } from "@/lib/i18n";
import { NOINDEX, SITE_URL } from "@/lib/site";

import "../globals.css";

export function generateStaticParams() {
  return LANGS.map((lang) => ({ lang }));
}

export const dynamicParams = false;

export async function generateMetadata({ params }: { params: Promise<{ lang: string }> }): Promise<Metadata> {
  const { lang } = await params;
  if (!isLang(lang)) return {};
  const t = translator(lang);
  return {
    metadataBase: new URL(SITE_URL),
    title: { default: t("meta.homeTitle"), template: `%s | ${t("brand.name")}` },
    description: t("meta.homeDescription"),
    applicationName: t("brand.name"),
    openGraph: { siteName: t("brand.name"), locale: lang === "bn" ? "bn_BD" : "en_US", type: "website", images: [{ url: "/brand/og-image.png", width: 1200, height: 630 }] },
    // Demo / preview copies (SITE_NOINDEX=1): no page is indexed or followed.
    ...(NOINDEX ? { robots: { index: false, follow: false } } : {}),
  };
}

export const viewport: Viewport = { themeColor: "#175FD6", width: "device-width", initialScale: 1 };

/** Every page: `<html lang>` for the page's language, skip link, header and footer. */
export default async function LangLayout({ children, params }: { children: React.ReactNode; params: Promise<{ lang: string }> }) {
  const { lang } = await params;
  if (!isLang(lang)) notFound();
  const t = translator(lang);
  const settings = await getSettings(lang);
  return (
    <html lang={lang} className={`${inter.variable} ${bengali.variable}`}>
      <body className="min-h-dvh">
        <a href="#main" className="sr-only z-50 rounded-control bg-surface px-4 py-2 focus:not-sr-only focus:fixed focus:left-4 focus:top-4">
          {t("nav.skip")}
        </a>
        <SiteHeader lang={lang} settings={settings} />
        <main id="main">{children}</main>
        <SiteFooter lang={lang} settings={settings} />
      </body>
    </html>
  );
}
