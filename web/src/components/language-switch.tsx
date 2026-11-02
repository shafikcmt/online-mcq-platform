"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/cn";
import type { Lang } from "@/lib/i18n";

/** বাংলা | English — the same page in the other language (each label in its own
 * language). The choice is remembered by the server (cookie) on the next visit. */
export function LanguageSwitch({ lang, label, className }: { lang: Lang; label: string; className?: string }) {
  const pathname = usePathname() ?? `/${lang}`;
  const rest = pathname.replace(/^\/(bn|en)(?=\/|$)/, "");
  return (
    <nav aria-label={label} className={cn("flex items-center rounded-full border border-line bg-surface p-0.5 text-sm", className)}>
      {(["bn", "en"] as const).map((code) => (
        <Link
          key={code}
          href={`/${code}${rest}`}
          hrefLang={code}
          lang={code}
          aria-current={code === lang ? "true" : undefined}
          className={cn(
            "rounded-full px-3 py-1.5 font-medium transition-colors",
            code === lang ? "bg-brand-50 text-brand-700" : "text-ink-muted hover:text-ink",
          )}
        >
          {code === "bn" ? "বাংলা" : "English"}
        </Link>
      ))}
    </nav>
  );
}
