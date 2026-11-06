import type { Metadata } from "next";

import { PageIntro } from "@/components/cards";
import { LoginForm } from "@/components/login-form";
import { safeNext } from "@/lib/account-helpers";
import { isLang, translator, type Lang } from "@/lib/i18n";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ lang: string }> }): Promise<Metadata> {
  const { lang } = await params;
  if (!isLang(lang)) return {};
  return { title: translator(lang)("account.login.title"), robots: { index: false, follow: false } };
}

/** Sign-in for buying a package: the mobile number and password of the app account. */
export default async function LoginPage({ params, searchParams }: { params: Promise<{ lang: string }>; searchParams: Promise<{ next?: string; expired?: string }> }) {
  const lang = (await params).lang as Lang;
  const query = await searchParams;
  const t = translator(lang);
  const next = safeNext(query.next, lang, `/${lang}/account/buy`);
  return (
    <>
      <PageIntro title={t("account.login.title")} body={t("account.login.body")} />
      <div className="mx-auto max-w-md px-4 sm:px-6">
        {query.expired ? (
          <p role="status" className="mb-4 rounded-control border border-line bg-surface p-3 text-sm text-ink-muted">
            {t("account.login.expired")}
          </p>
        ) : null}
        <LoginForm
          lang={lang}
          next={next}
          labels={{
            mobile: t("account.login.mobile"),
            password: t("account.login.password"),
            submit: t("account.login.submit"),
            submitting: t("account.login.submitting"),
            errors: {
              check: t("account.login.check"),
              invalid: t("account.login.invalid"),
              tooMany: t("account.login.tooMany"),
              unavailable: t("account.login.unavailable"),
            },
          }}
        />
        <p className="mt-6 text-sm text-ink-muted">{t("account.login.help")}</p>
      </div>
    </>
  );
}
