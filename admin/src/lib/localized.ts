import type { Locale } from "./i18n/messages";

/** Content is entered in Bangla, English or both. Show the UI language's version and
 * fall back to the other one, reporting which language is shown (for the `lang`
 * attribute, so screen readers and fonts treat the text correctly). */
export function localized(locale: Locale, bn: string, en: string): { text: string; lang: "bn" | "en" } {
  if (locale === "bn") return bn ? { text: bn, lang: "bn" } : { text: en, lang: "en" };
  return en ? { text: en, lang: "en" } : { text: bn, lang: "bn" };
}
