import type { Dashboard, DashboardExam } from "@/features/dashboard/types";

export type Spotlight = { exam: DashboardExam; state: "live" | "open" | "upcoming" };

/** The one exam Home puts in the spotlight: an exam open now that the student can start or
 * continue (a live exam first), otherwise the next upcoming exam. */
export function pickSpotlight(data: Dashboard): Spotlight | null {
  const ready = data.exams.available.items.filter((exam) => exam.can_start || exam.can_resume);
  const live = ready.find((exam) => exam.exam_type === "live");
  if (live) return { exam: live, state: "live" };
  if (ready[0]) return { exam: ready[0], state: "open" };
  const next = data.exams.upcoming.items[0];
  return next ? { exam: next, state: "upcoming" } : null;
}
