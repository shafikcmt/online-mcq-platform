import { QuestionImportView } from "@/components/content/question-import-view";
import { adminLookup } from "@/lib/api/lists";
import { titleMetadata } from "@/lib/i18n/metadata";
import type { Subject } from "@/types/content";

export const generateMetadata = () => titleMetadata("qi.title");

export default async function QuestionImportPage() {
  // The subjects a file may name; the same lookup the question filters use.
  const subjects = await adminLookup<Subject>("/admin/subjects/");
  return <QuestionImportView subjects={subjects.rows} />;
}
