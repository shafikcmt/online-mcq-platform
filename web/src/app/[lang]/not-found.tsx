"use client";

import Link from "next/link";
import { useParams } from "next/navigation";

import { isLang, translator } from "@/lib/i18n";

/** "Not found" inside /bn or /en (an unknown page or exam), in the page's language,
 * with the site's header and footer around it. */
export default function LangNotFound() {
  const { lang: raw } = useParams<{ lang: string }>();
  const lang = isLang(raw) ? raw : "bn";
  const t = translator(lang);
  return (
    <div className="mx-auto flex max-w-xl flex-col items-center gap-3 px-4 py-24 text-center">
      <p className="text-5xl font-bold text-brand-600">404</p>
      <h1 className="text-2xl font-bold text-ink">{t("error.notFoundTitle")}</h1>
      <p className="text-ink-muted">{t("error.notFoundBody")}</p>
      <Link href={`/${lang}`} className="mt-2 inline-flex min-h-11 items-center rounded-control bg-brand-600 px-5 font-semibold text-white hover:bg-brand-700">
        {t("error.home")}
      </Link>
    </div>
  );
}
