import type { Metadata } from "next";

import { LANGS, type Lang } from "./i18n";

/** The site's own public address (canonical links, sitemap, Open Graph). */
export const SITE_URL = (process.env.SITE_URL ?? "https://livemodeltest.com").replace(/\/$/, "");

/** `SITE_NOINDEX=1` (set at build time) keeps a copy of the site out of search engines — for
 * a staging / client demo or a preview (e.g. Vercel): robots.txt disallows everything, every
 * page says `noindex, nofollow` (meta tag + `X-Robots-Tag` header) and there is no sitemap
 * link. Never set it for the real livemodeltest.com. */
export const NOINDEX = process.env.SITE_NOINDEX === "1";

/** `path` without a language ("" for home, "/exams"…) → the page in both languages, for
 * `hreflang` alternates (`x-default` is Bangla, the platform default). */
export function alternates(lang: Lang, path: string): Metadata["alternates"] {
  const languages: Record<string, string> = {};
  for (const code of LANGS) languages[code === "bn" ? "bn-BD" : "en"] = `${SITE_URL}/${code}${path}`;
  languages["x-default"] = `${SITE_URL}/bn${path}`;
  return { canonical: `${SITE_URL}/${lang}${path}`, languages };
}

/** Structured data for a `<script type="application/ld+json">` tag — the only raw HTML the
 * site writes. Admin-written text goes inside, so "<" is escaped (and U+2028/2029, which
 * end lines in older script parsers): no text can close the tag and start a script. */
export function jsonLd(data: unknown): string {
  return JSON.stringify(data)
    .replace(/</g, "\\u003c")
    .replace(LINE_SEPARATORS, (char) => (char === "\u2028" ? "\\u2028" : "\\u2029"));
}

const LINE_SEPARATORS = new RegExp("[\u2028\u2029]", "g");
