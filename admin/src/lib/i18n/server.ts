import "server-only";

import { cookies } from "next/headers";

import { DEFAULT_LOCALE, isLocale, type Locale } from "./messages";

export const LOCALE_COOKIE = "admin_lang";

export async function getLocale(): Promise<Locale> {
  const value = (await cookies()).get(LOCALE_COOKIE)?.value;
  return isLocale(value) ? value : DEFAULT_LOCALE;
}
