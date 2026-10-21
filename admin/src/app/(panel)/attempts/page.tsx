import { AttemptsView } from "@/components/attempts/attempts-view";
import { adminList } from "@/lib/api/lists";
import { readExamOrNull } from "@/lib/api/result-page";
import { readUserOrNull } from "@/lib/api/user-page";
import { ATTEMPT_LIST } from "@/lib/content-specs";
import { titleMetadata } from "@/lib/i18n/metadata";
import { parseListParams } from "@/lib/list-params";
import type { AdminAttempt } from "@/types/attempts";

export const generateMetadata = () => titleMetadata("attempts.title");

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function AttemptsPage({ searchParams }: { searchParams: SearchParams }) {
  const state = parseListParams(await searchParams, ATTEMPT_LIST);
  const examId = state.filters.exam ? Number(state.filters.exam) : null;
  const userId = state.filters.user ? Number(state.filters.user) : null;
  // One page of attempts (exam titles and student names come with each row) and, when
  // filtered, that exam and that student for the chips — in parallel. No catalogue or
  // user list download.
  const [data, exam, user] = await Promise.all([
    adminList<AdminAttempt>("/admin/attempts/", state, ATTEMPT_LIST, "/attempts"),
    examId ? readExamOrNull(examId) : Promise.resolve(null),
    userId ? readUserOrNull(userId) : Promise.resolve(null),
  ]);
  const student = userId ? { id: userId, user: user && { id: user.id, full_name: user.full_name } } : null;
  return <AttemptsView data={data} state={state} exam={examId ? { id: examId, exam } : null} student={student} />;
}
