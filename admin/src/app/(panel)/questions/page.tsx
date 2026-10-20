import { QuestionsView } from "@/components/content/questions-view";
import { adminList, adminLookup } from "@/lib/api/lists";
import { QUESTION_LIST } from "@/lib/content-specs";
import { titleMetadata } from "@/lib/i18n/metadata";
import { parseListParams } from "@/lib/list-params";
import type { Category, Question, Subject } from "@/types/content";

export const generateMetadata = () => titleMetadata("questions.title");

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function QuestionsPage({ searchParams }: { searchParams: SearchParams }) {
  const state = parseListParams(await searchParams, QUESTION_LIST);
  // One page of questions + the category/subject names (filters and table), in parallel.
  const [data, categories, subjects] = await Promise.all([
    adminList<Question>("/admin/questions/", state, QUESTION_LIST, "/questions"),
    adminLookup<Category>("/admin/categories/"),
    adminLookup<Subject>("/admin/subjects/"),
  ]);
  return (
    <QuestionsView
      data={data}
      state={state}
      categories={categories.rows}
      subjects={subjects.rows}
      lookupTruncated={categories.truncated || subjects.truncated}
    />
  );
}
