import { ExamEditor } from "@/components/exams/exam-editor";
import { examLookups } from "@/lib/api/exam-page";
import { titleMetadata } from "@/lib/i18n/metadata";

export const generateMetadata = () => titleMetadata("exam.createTitle");

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function NewExamPage({ searchParams }: { searchParams: SearchParams }) {
  const raw = (await searchParams).category;
  const value = typeof raw === "string" && /^\d{1,9}$/.test(raw) ? Number(raw) : 0;
  const lookups = await examLookups();
  // Pre-select the category only if it exists (it came from the list filter in the URL).
  const initialCategory = lookups.categories.some((category) => category.id === value) ? value : undefined;
  return <ExamEditor exam={null} questions={[]} {...lookups} initialCategory={initialCategory} />;
}
