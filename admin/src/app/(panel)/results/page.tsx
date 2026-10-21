import { ResultsView } from "@/components/results/results-view";
import { adminList } from "@/lib/api/lists";
import { readExamOrNull } from "@/lib/api/result-page";
import { RESULT_LIST } from "@/lib/content-specs";
import { titleMetadata } from "@/lib/i18n/metadata";
import { parseListParams } from "@/lib/list-params";
import type { AdminResult } from "@/types/results";

export const generateMetadata = () => titleMetadata("results.title");

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function ResultsPage({ searchParams }: { searchParams: SearchParams }) {
  const state = parseListParams(await searchParams, RESULT_LIST);
  const examId = state.filters.exam ? Number(state.filters.exam) : null;
  // One page of results (exam titles come with each row) and, when the list is filtered
  // by exam, that exam for its result controls — in parallel. No exam catalogue download.
  const [data, exam] = await Promise.all([
    adminList<AdminResult>("/admin/results/", state, RESULT_LIST, "/results"),
    examId ? readExamOrNull(examId) : Promise.resolve(null),
  ]);
  return <ResultsView data={data} state={state} exam={examId ? { id: examId, exam } : null} />;
}
