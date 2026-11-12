import Link from "next/link";

import type { Settings } from "@/lib/api";
import { translator, type Lang } from "@/lib/i18n";

import { AppButton } from "./app-button";
import { LanguageSwitch } from "./language-switch";
import { Logo } from "./logo";
import { MobileMenu } from "./mobile-menu";

/** Every page, for the footer and the phone menu. `main` ones are also in the desktop
 * header (the logo is the way home; About / FAQ / Contact stay in the footer so the header
 * fits on one row in both languages). */
export function navItems(lang: Lang) {
  const t = translator(lang);
  return [
    { href: `/${lang}`, label: t("nav.home"), main: false },
    { href: `/${lang}/exams`, label: t("nav.exams"), main: true },
    // Footer and menu only: the header row already holds its four main links.
    { href: `/${lang}/routine`, label: t("nav.routine"), main: false },
    { href: `/${lang}/materials`, label: t("nav.materials"), main: false },
    { href: `/${lang}/packages`, label: t("nav.packages"), main: true },
    { href: `/${lang}/leaderboard`, label: t("nav.leaderboard"), main: true },
    { href: `/${lang}/notices`, label: t("nav.notices"), main: true },
    { href: `/${lang}/about`, label: t("nav.about"), main: false },
    { href: `/${lang}/faq`, label: t("nav.faq"), main: false },
    { href: `/${lang}/contact`, label: t("nav.contact"), main: false },
  ];
}

function appLabels(lang: Lang) {
  const t = translator(lang);
  return { download: t("app.download"), open: t("app.open"), soon: t("app.soon") };
}

export function SiteHeader({ lang, settings }: { lang: Lang; settings: Settings | null }) {
  const t = translator(lang);
  const items = navItems(lang);
  const app = { downloadUrl: settings?.app_download_url ?? "", openUrl: settings?.app_open_url ?? "", labels: appLabels(lang), lang };
  return (
    <header className="sticky top-0 z-30 border-b border-line bg-surface/95 backdrop-blur supports-[backdrop-filter]:bg-surface/80">
      <div className="mx-auto flex h-16 max-w-6xl items-center gap-4 px-4 sm:px-6">
        <Logo lang={lang} t={t} eager />
        <nav aria-label={t("nav.label")} className="ml-6 hidden items-center gap-1 lg:flex">
          {items.filter((item) => item.main).map((item) => (
            <Link key={item.href} href={item.href} className="rounded-control px-3 py-2 text-sm font-medium text-ink-muted hover:bg-brand-50 hover:text-ink">
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-3">
          <LanguageSwitch lang={lang} label={t("lang.label")} className="hidden sm:flex" />
          <AppButton {...app} className="hidden sm:inline-flex" />
          <MobileMenu items={items} labels={{ menu: t("nav.menu"), close: t("nav.close"), nav: t("nav.label") }}>
            <LanguageSwitch lang={lang} label={t("lang.label")} className="self-start" />
            <AppButton {...app} size="lg" />
          </MobileMenu>
        </div>
      </div>
    </header>
  );
}

export function SiteFooter({ lang, settings }: { lang: Lang; settings: Settings | null }) {
  const t = translator(lang);
  const contact = [settings?.contact_phone, settings?.contact_email, settings?.address].filter(Boolean) as string[];
  return (
    <footer className="mt-20 border-t border-line bg-surface">
      <div className="mx-auto grid max-w-6xl gap-10 px-4 py-12 sm:px-6 md:grid-cols-3">
        <div className="flex flex-col gap-3">
          <Logo lang={lang} t={t} />
          <p className="text-sm text-ink-muted">{settings?.tagline || t("brand.tagline")}</p>
          <LanguageSwitch lang={lang} label={t("lang.label")} className="self-start" />
        </div>
        <div>
          <h2 className="text-sm font-semibold text-ink">{t("footer.explore")}</h2>
          <ul className="mt-3 grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
            {navItems(lang).map((item) => (
              <li key={item.href}>
                <Link href={item.href} className="text-ink-muted hover:text-brand-700">
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </div>
        {contact.length || settings?.app_download_url ? (
        <div className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold text-ink">{contact.length ? t("footer.contact") : t("footer.getApp")}</h2>
          {contact.map((line) => (
            <p key={line} className="text-sm text-ink-muted">
              {line}
            </p>
          ))}
          {/* A quiet text link, not a second button: the header already carries the main one. */}
          {settings?.app_download_url ? (
            <Link href={`/${lang}/download`} className="self-start text-sm font-semibold text-brand-700 hover:underline">
              {appLabels(lang).download}
            </Link>
          ) : null}
        </div>
        ) : null}
      </div>
      <div className="flex flex-col items-center justify-between gap-2 border-t border-line px-4 py-5 text-center text-xs text-ink-subtle sm:flex-row sm:px-6 lg:mx-auto lg:max-w-6xl">
        <p>{t("footer.rights", { year: new Date().getFullYear() })}</p>
        <p>
          {t("footer.developedBy")}{" "}
          <a href="https://www.shafiqul.dev/" target="_blank" rel="noopener" className="font-semibold text-brand-700 hover:underline">
            Md Shafiqul Islam
          </a>
        </p>
      </div>
    </footer>
  );
}
