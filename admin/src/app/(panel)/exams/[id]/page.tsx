import { ExamEditor } from "@/components/exams/exam-editor";
import { examLookups, readExam } from "@/lib/api/exam-page";
import { titleMetadata } from "@/lib/i18n/metadata";

type Params = Promise<{ id: string }>;

export const generateMetadata = () => titleMetadata("exam.editTitle");

export default async function EditExamPage({ params }: { params: Params }) {
  const { id } = await params;
  const [{ exam, questions }, lookups] = await Promise.all([readExam(id), examLookups()]);
  // `key`: another exam (e.g. after Duplicate) starts a fresh editor.
  return <ExamEditor key={exam.id} exam={exam} questions={questions} {...lookups} />;
}
