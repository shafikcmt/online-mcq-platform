import { api } from "@/api/client";

/** `GET /public/categories/` — active categories, localized, with how many exams a
 * student can see in each (`exam_count`, the same rule as the exam list). */
export type HomeCategory = { slug: string; name: string; exam_count: number };

export const CATEGORY_LIMIT = 6;

export async function fetchCategories(): Promise<HomeCategory[]> {
  const data = await api<{ results: HomeCategory[] }>(`/public/categories/?page_size=20`);
  return data.results.filter((category) => category.exam_count > 0).slice(0, CATEGORY_LIMIT);
}
