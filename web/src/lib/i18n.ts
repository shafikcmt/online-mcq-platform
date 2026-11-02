import bn from "../../messages/bn.json";
import en from "../../messages/en.json";

/** Website languages (docs/LOCALIZATION.md §8): `/bn/…` and `/en/…`, Bangla first. Every
 * text comes from `messages/{bn,en}.json` (a test checks both have the same keys). */
export const LANGS = ["bn", "en"] as const;
export type Lang = (typeof LANGS)[number];
export const DEFAULT_LANG: Lang = "bn";

export type Messages = typeof en;

const dictionaries: Record<Lang, Messages> = { bn, en };

export function isLang(value: unknown): value is Lang {
  return value === "bn" || value === "en";
}

/** `t("home.hero.title", { name })` — dotted key lookup with `{{name}}` placeholders.
 * `{{n|one|other}}` picks an English word by count ("{{n}} {{n|day|days}}"); Bangla nouns
 * do not change, so Bangla texts never need it. */
export function translator(lang: Lang) {
  const messages = dictionaries[lang];
  return function t(key: string, values: Record<string, string | number> = {}): string {
    const found = key.split(".").reduce<unknown>((node, part) => (node as Record<string, unknown> | undefined)?.[part], messages);
    if (typeof found !== "string") return key;
    return found
      .replace(/\{\{(\w+)\|([^|{}]*)\|([^|{}]*)\}\}/g, (_match, name: string, one: string, other: string) =>
        Number(values[name]) === 1 ? one : other,
      )
      .replace(/\{\{(\w+)\}\}/g, (_match, name: string) => String(values[name] ?? ""));
  };
}

export type T = ReturnType<typeof translator>;

/** The whole message tree, for structured content (lists of features, steps…). */
export function messages(lang: Lang): Messages {
  return dictionaries[lang];
}
