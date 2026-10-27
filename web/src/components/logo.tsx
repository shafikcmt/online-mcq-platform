/* eslint-disable @next/next/no-img-element -- a small static brand asset */
import Link from "next/link";

import type { Lang, T } from "@/lib/i18n";

/** The Live Model Test mark + name (the same mark as the app and the Admin Panel). */
export function Logo({ lang, t }: { lang: Lang; t: T }) {
  return (
    <Link href={`/${lang}`} className="flex items-center gap-2 rounded-control" aria-label={t("brand.name")}>
      <img src="/brand/logo-mark.png" alt="" width={36} height={36} className="size-9" />
      <span className="text-lg font-bold tracking-tight text-brand-900">{t("brand.name")}</span>
    </Link>
  );
}
