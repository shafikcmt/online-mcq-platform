import { useCallback } from "react";

import { usePages } from "@/lib/use-pages";

import { fetchExams } from "./api";
import type { ExamWhen, StudentExam } from "./types";

const slugOf = (exam: StudentExam) => exam.slug;

/** The Exams tab's list for one filter, optionally one category (see `usePages`). */
export function useExamPages(when: ExamWhen, category?: string) {
  const load = useCallback((page: number) => fetchExams(when, page, category), [when, category]);
  const list = usePages(load, `${when}|${category ?? ""}`, slugOf);
  return { ...list, serverTime: list.extra?.server_time };
}
