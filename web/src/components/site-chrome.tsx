import Link from "next/link";

import type { Settings } from "@/lib/api";
import { translator, type Lang } from "@/lib/i18n";

import { AppButton } from "./app-button";
import { LanguageSwitch } from "./language-switch";
import { Logo } from "./logo";
import { MobileMenu } from "./mobile-menu";

/** Pages linked from the header and footer. Each slice of Milestone 9 adds its pages here. */
export function navItems(lang: Lang) {
  const t = translator(lang);
  return [
    { href: `/${lang}`, label: t("nav.home") },
    { href: `/${lang}/exams`, label: t("nav.exams") },
    { href: `/${lang}/packages`, label: t("nav.packages") },
    { href: `/${lang}/leaderboard`, label: t("nav.leaderboard") },
    { href: `/${lang}/notices`, label: t("nav.notices") },
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
        <Logo lang={lang} t={t} />
        <nav aria-label={t("nav.label")} className="ml-6 hidden items-center gap-1 lg:flex">
          {items.map((item) => (
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
          <ul className="mt-3 flex flex-col gap-2 text-sm">
            {navItems(lang).map((item) => (
              <li key={item.href}>
                <Link href={item.href} className="text-ink-muted hover:text-brand-700">
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </div>
        <div className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold text-ink">{contact.length ? t("footer.contact") : t("footer.getApp")}</h2>
          {contact.map((line) => (
            <p key={line} className="text-sm text-ink-muted">
              {line}
            </p>
          ))}
          <AppButton downloadUrl={settings?.app_download_url ?? ""} openUrl={settings?.app_open_url ?? ""} labels={appLabels(lang)} lang={lang} className="self-start" />
        </div>
      </div>
      <p className="border-t border-line py-5 text-center text-xs text-ink-subtle">{t("footer.rights", { year: new Date().getFullYear() })}</p>
    </footer>
  );
}
