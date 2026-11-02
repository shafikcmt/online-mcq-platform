/* eslint-disable @next/next/no-img-element -- a small static SVG; next/image adds nothing for SVG */
import Link from "next/link";

import type { Lang, T } from "@/lib/i18n";

/** The official Live Model Test logo ("Rank Signal" brand kit, owner-supplied SVG): the icon
 * and the "LIVE MODEL TEST" wordmark in one image — the same artwork as the Admin Panel
 * and the app. An SVG stays sharp at every size and is only ~8 KB. */
export function Logo({ lang, t, eager = false }: { lang: Lang; t: T; eager?: boolean }) {
  return (
    <Link href={`/${lang}`} className="flex items-center rounded-control" aria-label={t("brand.name")}>
      <img
        src="/brand/lockup-horizontal.svg"
        alt=""
        width={1244}
        height={442}
        className="h-11 w-auto"
        loading={eager ? "eager" : "lazy"}
        fetchPriority={eager ? "high" : undefined}
        draggable={false}
      />
    </Link>
  );
}
