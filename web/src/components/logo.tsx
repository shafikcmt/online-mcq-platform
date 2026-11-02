import Image from "next/image";
import Link from "next/link";

import type { Lang, T } from "@/lib/i18n";

/** The Live Model Test mark + name (the same mark as the app and the Admin Panel). The mark
 * goes through next/image: resized to the size it is shown at (36 px, 72 px on sharp
 * screens) and served as WebP/AVIF, instead of the full 67 KB source PNG. */
export function Logo({ lang, t, eager = false }: { lang: Lang; t: T; eager?: boolean }) {
  return (
    <Link href={`/${lang}`} className="flex items-center gap-2 rounded-control" aria-label={t("brand.name")}>
      <Image src="/brand/logo-mark.png" alt="" width={36} height={36} className="size-9" loading={eager ? "eager" : "lazy"} />
      <span className="text-lg font-bold tracking-tight text-brand-900">{t("brand.name")}</span>
    </Link>
  );
}
