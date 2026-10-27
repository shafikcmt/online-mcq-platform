import type { MetadataRoute } from "next";

import { publicGet, type Exam, type LeaderboardExam, type Page } from "@/lib/api";
import { LANGS } from "@/lib/i18n";
import { SITE_URL } from "@/lib/site";

/** Every public page in both languages (each slice adds its paths), plus each published
 * exam's page and each public merit list (the first 100 of each; regenerated with the
 * pages). */
const PATHS = ["", "/exams", "/packages", "/leaderboard", "/notices"];

export const revalidate = 3600;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const [exams, boards] = await Promise.all([
    publicGet<Page<Exam>>("exams/?page_size=100", "bn"),
    publicGet<Page<LeaderboardExam>>("leaderboards/?page_size=100", "bn"),
  ]);
  const detailPaths = [
    ...(exams?.results ?? []).map((exam) => `/exams/${exam.slug}`),
    ...(boards?.results ?? []).map((exam) => `/exams/${exam.slug}/leaderboard`),
  ];
  return [...PATHS, ...detailPaths].flatMap((path) =>
    LANGS.map((lang) => ({
      url: `${SITE_URL}/${lang}${path}`,
      changeFrequency: "daily" as const,
      priority: path === "" ? 1 : path.startsWith("/exams/") ? 0.5 : 0.7,
      alternates: { languages: Object.fromEntries(LANGS.map((code) => [code, `${SITE_URL}/${code}${path}`])) },
    })),
  );
}
