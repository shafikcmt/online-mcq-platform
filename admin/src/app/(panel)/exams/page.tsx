import { ExamsView } from "@/components/exams/exams-view";
import { adminList, adminLookup } from "@/lib/api/lists";
import { EXAM_LIST } from "@/lib/content-specs";
import { titleMetadata } from "@/lib/i18n/metadata";
import { parseListParams } from "@/lib/list-params";
import type { Category, Subject } from "@/types/content";
import type { Exam } from "@/types/exams";

export const generateMetadata = () => titleMetadata("exams.title");

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function ExamsPage({ searchParams }: { searchParams: SearchParams }) {
  const state = parseListParams(await searchParams, EXAM_LIST);
  // One page of exams + the category/subject names (filters and table), in parallel.
  const [data, categories, subjects] = await Promise.all([
    adminList<Exam>("/admin/exams/", state, EXAM_LIST, "/exams"),
    adminLookup<Category>("/admin/categories/"),
    adminLookup<Subject>("/admin/subjects/"),
  ]);
  return (
    <ExamsView
      data={data}
      state={state}
      categories={categories.rows}
      subjects={subjects.rows}
      lookupTruncated={categories.truncated || subjects.truncated}
    />
  );
}
