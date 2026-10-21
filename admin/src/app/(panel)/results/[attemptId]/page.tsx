import { ResultDetail } from "@/components/results/result-detail";
import { readExamOrNull, readResult } from "@/lib/api/result-page";
import { titleMetadata } from "@/lib/i18n/metadata";

type Params = Promise<{ attemptId: string }>;

export const generateMetadata = () => titleMetadata("resultDetail.title");

export default async function ResultPage({ params }: { params: Params }) {
  const result = await readResult((await params).attemptId);
  const exam = await readExamOrNull(result.exam_id);
  return <ResultDetail result={result} exam={exam} />;
}
