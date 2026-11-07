import type { Metadata } from "next";
import Link from "next/link";

import { AutoRefresh } from "@/components/auto-refresh";
import { PageIntro } from "@/components/cards";
import { isPaymentId } from "@/lib/account-helpers";
import { getPayment, getToken } from "@/lib/account";
import { isLang, translator, type Lang } from "@/lib/i18n";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ lang: string }> }): Promise<Metadata> {
  const { lang } = await params;
  if (!isLang(lang)) return {};
  return { title: translator(lang)("account.return.title"), robots: { index: false, follow: false } };
}

const button = "inline-flex min-h-11 items-center justify-center rounded-control bg-brand-600 px-5 font-semibold text-white hover:bg-brand-700";

/** Where the payment provider sends the student back. The address carries a `status` and a
 * `payment` id, but only the id is used, and only to ask the server about the signed-in
 * student's OWN payment: what the server answers is what is shown (a link can say anything). */
export default async function PaymentReturnPage({ params, searchParams }: { params: Promise<{ lang: string }>; searchParams: Promise<{ payment?: string }> }) {
  const lang = (await params).lang as Lang;
  const { payment: paymentId } = await searchParams;
  const t = translator(lang);
  const buy = `/${lang}/account/buy`;

  let kind: "success" | "pending" | "failed" | "cancelled" | "signedOut" | "unknown" | "unavailable" = "unknown";
  let packageName = "";
  if (isPaymentId(paymentId)) {
    const token = await getToken();
    if (!token) kind = "signedOut";
    else {
      const result = await getPayment(token, paymentId, lang);
      if (result.ok) {
        kind = result.data.status;
        packageName = result.data.package.name;
      } else if (result.status === 401) kind = "signedOut";
      else if (result.status === 404) kind = "unknown";
      else kind = "unavailable";
    }
  }
  const here = isPaymentId(paymentId) ? `/${lang}/payment-return?payment=${paymentId}` : buy;

  return (
    <>
      <PageIntro title={t("account.return.title")} />
      <div className="mx-auto max-w-xl px-4 pb-16 sm:px-6">
        {kind === "unavailable" ? (
          <p role="status" className="rounded-card border border-line bg-surface p-6 text-ink-muted">
            {t("account.return.unavailable")}
          </p>
        ) : (
          <section role="status" aria-live="polite" className="flex flex-col items-start gap-4 rounded-card border border-line bg-surface p-6 shadow-sm">
            <h2 className="text-xl font-bold text-ink">{t(`account.return.${kind}.title`)}</h2>
            <p className="text-ink-muted">{t(`account.return.${kind}.body`, { name: packageName })}</p>
            {kind === "pending" ? <AutoRefresh /> : null}
            {kind === "failed" || kind === "cancelled" || kind === "unknown" ? (
              <Link href={buy} className={button}>
                {t("account.return.tryAgain")}
              </Link>
            ) : null}
            {kind === "signedOut" ? (
              <Link href={`/${lang}/account/login?next=${encodeURIComponent(here)}`} className={button}>
                {t("account.return.signIn")}
              </Link>
            ) : null}
          </section>
        )}
      </div>
    </>
  );
}
