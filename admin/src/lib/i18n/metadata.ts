import "server-only";

import type { Metadata } from "next";

import { MESSAGES, translate, type MessageKey } from "./messages";
import { getLocale } from "./server";

/** `generateMetadata` helper: the browser tab title in the panel's current language. */
export async function titleMetadata(key: MessageKey, vars?: Record<string, string | number>): Promise<Metadata> {
  return { title: translate(MESSAGES[await getLocale()], key, vars) };
}
