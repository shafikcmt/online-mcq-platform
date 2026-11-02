import { ResultsView } from "@/components/results/results-view";
import { adminList } from "@/lib/api/lists";
import { readExamOrNull } from "@/lib/api/result-page";
import { readUserOrNull } from "@/lib/api/user-page";
import { RESULT_LIST } from "@/lib/content-specs";
import { titleMetadata } from "@/lib/i18n/metadata";
import { parseListParams } from "@/lib/list-params";
import type { AdminResult } from "@/types/results";

export const generateMetadata = () => titleMetadata("results.title");

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function ResultsPage({ searchParams }: { searchParams: SearchParams }) {
  const state = parseListParams(await searchParams, RESULT_LIST);
  const examId = state.filters.exam ? Number(state.filters.exam) : null;
  const userId = state.filters.user ? Number(state.filters.user) : null;
  // One page of results (exam titles come with each row) and, when the list is filtered,
  // that exam (for its result controls) and that student (for the filter's name) — in
  // parallel. No exam catalogue or user list download.
  const [data, exam, user] = await Promise.all([
    adminList<AdminResult>("/admin/results/", state, RESULT_LIST, "/results"),
    examId ? readExamOrNull(examId) : Promise.resolve(null),
    userId ? readUserOrNull(userId) : Promise.resolve(null),
  ]);
  // Only the name goes to the client: the counts and masked contact are not needed here.
  const student = userId ? { id: userId, user: user && { id: user.id, full_name: user.full_name } } : null;
  return <ResultsView data={data} state={state} exam={examId ? { id: examId, exam } : null} student={student} />;
}
