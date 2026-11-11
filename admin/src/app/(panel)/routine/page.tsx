import { RoutineView } from "@/components/exams/routine-view";
import { adminRead } from "@/lib/api/server";
import { titleMetadata } from "@/lib/i18n/metadata";
import type { RoutinePdfInfo, RoutineResponse } from "@/types/routine";

export const generateMetadata = () => titleMetadata("rt.title");

export default async function RoutinePage() {
  // The live schedule (what students see) and the PDF's own status, in parallel.
  const [routine, pdf] = await Promise.all([adminRead<RoutineResponse>("/public/routine/"), adminRead<RoutinePdfInfo>("/admin/routine/pdf/")]);
  return <RoutineView exams={routine.exams} initialPdf={pdf} />;
}
