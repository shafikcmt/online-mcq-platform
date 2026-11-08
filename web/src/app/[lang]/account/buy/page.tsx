import { randomBytes } from "node:crypto";

import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { startCheckout, signOut } from "@/app/[lang]/account/actions";
import { Chip, EmptyNote, PageIntro, UnavailableNote } from "@/components/cards";
import { MethodPicker } from "@/components/method-picker";
import { PayButton } from "@/components/pay-button";
import { methodsForPrice, newIdempotencyKey } from "@/lib/account-helpers";
import { getToken, listMethods, listPackages } from "@/lib/account";
import { date, digits, money } from "@/lib/format";
import { isLang, translator, type Lang } from "@/lib/i18n";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ lang: string }> }): Promise<Metadata> {
  const { lang } = await params;
  if (!isLang(lang)) return {};
  return { title: translator(lang)("account.buy.title"), robots: { index: false, follow: false } };
}

const NOTICES = new Set(["unavailable", "failed"]);

/** The signed-in student's package list with a "Pay now" button on each. Prices and the
 * student's own subscription come from the server; the button sends only the package. */
export default async function BuyPage({ params, searchParams }: { params: Promise<{ lang: string }>; searchParams: Promise<{ notice?: string }> }) {
  const lang = (await params).lang as Lang;
  const { notice } = await searchParams;
  const t = translator(lang);
  const here = `/${lang}/account/buy`;
  const toLogin = (extra = "") => `/${lang}/account/login?next=${encodeURIComponent(here)}${extra}`;

  const token = await getToken();
  if (!token) redirect(toLogin());
  const [packages, methods] = await Promise.all([listPackages(token, lang), listMethods(token, lang)]);
  const choices = methods.ok ? methods.data.results : [];
  if (!packages.ok && packages.status === 401) redirect(toLogin("&expired=1"));

  return (
    <>
      <PageIntro title={t("account.buy.title")} body={t("account.buy.body")} />
      <div className="mx-auto max-w-6xl px-4 pb-16 sm:px-6">
        {notice && NOTICES.has(notice) ? (
          <p role="alert" className="mb-6 rounded-control border border-danger-700/20 bg-danger-50 p-3 text-sm font-medium text-danger-700">
            {t(`account.buy.notice.${notice}`)}
          </p>
        ) : null}

        {!packages.ok ? (
          <UnavailableNote text={t("account.buy.loadFailed")} />
        ) : packages.data.results.length === 0 ? (
          <EmptyNote text={t("account.buy.empty")} />
        ) : (
          <ul className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {packages.data.results.map((pkg) => {
              const active = pkg.subscription?.active_now ? pkg.subscription : null;
              // Only the methods that accept this package's price. If the list could not be
              // loaded, nothing is shown and the server's default method is used.
              const fit = methodsForPrice(choices, pkg.price);
              const blocked = choices.length > 0 && fit.length === 0;
              return (
                <li key={pkg.id} className="flex h-full flex-col gap-4 rounded-card border border-line bg-surface p-6 shadow-sm">
                  <div className="flex items-start justify-between gap-3">
                    <h2 className="text-lg font-bold text-ink">{pkg.name}</h2>
                    {active ? <Chip tone="success">{t("account.buy.activeUntil", { date: date(active.expires_at, lang) })}</Chip> : null}
                  </div>
                  <p className="flex items-baseline gap-1.5">
                    <span className="text-3xl font-bold text-brand-800">{money(pkg.price, pkg.currency, lang)}</span>
                    <span className="text-ink-muted">{t("package.per", { days: t("package.days", { n: digits(pkg.validity_days, lang) }) })}</span>
                  </p>
                  {pkg.description ? <p className="text-sm text-ink-muted">{pkg.description}</p> : null}
                  {pkg.features.length ? (
                    <ul className="flex flex-col gap-1.5 text-sm">
                      {pkg.features.map((feature) => (
                        <li key={feature} className="flex gap-2">
                          <span aria-hidden className="text-success-700">
                            ✓
                          </span>
                          {feature}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  <form action={startCheckout} className="mt-auto flex flex-col gap-2 pt-2">
                    <input type="hidden" name="lang" value={lang} />
                    <input type="hidden" name="package_id" value={pkg.id} />
                    <input type="hidden" name="idempotency_key" value={newIdempotencyKey(randomBytes(8).toString("hex"))} />
                    <MethodPicker id={`method-${pkg.id}`} methods={fit} legend={t("account.buy.payWith")} testBadge={t("account.buy.testBadge")} testNote={t("account.buy.testNote")} />
                    {blocked ? <p className="text-sm text-ink-muted">{t("account.buy.noMethod")}</p> : null}
                    <PayButton disabled={blocked} label={t(active ? "account.buy.extend" : "account.buy.pay")} busyLabel={t("account.buy.paying")} variant={active ? "secondary" : "primary"} />
                    <p className="text-xs text-ink-muted">{t("account.buy.secure")}</p>
                  </form>
                </li>
              );
            })}
          </ul>
        )}

        <form action={signOut} className="mt-10">
          <input type="hidden" name="lang" value={lang} />
          <button type="submit" className="min-h-11 rounded-control px-3 font-semibold text-brand-700 hover:bg-brand-50">
            {t("account.buy.signOut")}
          </button>
        </form>
      </div>
    </>
  );
}
