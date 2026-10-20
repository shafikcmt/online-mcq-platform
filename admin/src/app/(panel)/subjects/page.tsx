import { SubjectsView } from "@/components/content/subjects-view";
import { adminList, adminLookup } from "@/lib/api/lists";
import { SUBJECT_LIST } from "@/lib/content-specs";
import { titleMetadata } from "@/lib/i18n/metadata";
import { parseListParams } from "@/lib/list-params";
import type { Category, Subject } from "@/types/content";

export const generateMetadata = () => titleMetadata("subjects.title");

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function SubjectsPage({ searchParams }: { searchParams: SearchParams }) {
  const state = parseListParams(await searchParams, SUBJECT_LIST);
  // Independent reads, fetched in parallel: one page of subjects + the category names.
  const [data, categories] = await Promise.all([
    adminList<Subject>("/admin/subjects/", state, SUBJECT_LIST, "/subjects"),
    adminLookup<Category>("/admin/categories/"),
  ]);
  return (
    <SubjectsView data={data} state={state} categories={categories.rows} categoriesTruncated={categories.truncated} />
  );
}
