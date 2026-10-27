import type { MetadataRoute } from "next";

import { LANGS } from "@/lib/i18n";
import { SITE_URL } from "@/lib/site";

/** Every public page in both languages (each slice adds its paths). */
const PATHS = [""];

export default function sitemap(): MetadataRoute.Sitemap {
  return PATHS.flatMap((path) =>
    LANGS.map((lang) => ({
      url: `${SITE_URL}/${lang}${path}`,
      changeFrequency: "daily" as const,
      priority: path === "" ? 1 : 0.7,
      alternates: { languages: Object.fromEntries(LANGS.map((code) => [code, `${SITE_URL}/${code}${path}`])) },
    })),
  );
}
