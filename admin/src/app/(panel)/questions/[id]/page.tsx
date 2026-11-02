import { QuestionForm } from "@/components/content/question-form";
import { questionEditorData, readQuestion } from "@/lib/api/question-page";
import { titleMetadata } from "@/lib/i18n/metadata";

type Params = Promise<{ id: string }>;

export async function generateMetadata({ params }: { params: Params }) {
  return titleMetadata("questions.editTitle", { id: (await params).id });
}

export default async function EditQuestionPage({ params }: { params: Params }) {
  const question = await readQuestion((await params).id);
  const { categories, subjects } = await questionEditorData(question.category);
  // `key`: another question starts a fresh editor (a refresh after saving keeps it).
  return (
    <QuestionForm
      key={question.id}
      question={question}
      categories={categories}
      initialSubjects={subjects}
    />
  );
}
