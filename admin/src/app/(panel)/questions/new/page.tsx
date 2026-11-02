import { QuestionForm } from "@/components/content/question-form";
import { questionEditorData } from "@/lib/api/question-page";
import { titleMetadata } from "@/lib/i18n/metadata";

export const generateMetadata = () => titleMetadata("questions.createTitle");

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function NewQuestionPage({ searchParams }: { searchParams: SearchParams }) {
  const raw = (await searchParams).category;
  const value = typeof raw === "string" && /^\d{1,9}$/.test(raw) ? Number(raw) : 0;
  const { categories, subjects } = await questionEditorData(value || null);
  // Pre-select the category only if it exists (it came from the list filter in the URL).
  const initialCategory = categories.some((category) => category.id === value) ? value : undefined;
  return (
    <QuestionForm
      question={null}
      categories={categories}
      initialSubjects={initialCategory ? subjects : []}
      initialCategory={initialCategory}
    />
  );
}
