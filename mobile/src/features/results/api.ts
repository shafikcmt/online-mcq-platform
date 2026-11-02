import { api } from "@/api/client";
import type { Page } from "@/lib/use-pages";

import type { HistoryItem, LeaderboardPage, ResultDetail, Review } from "./types";

const PAGE_SIZE = 20;

/** My results whose exam results are visible now (newest first). */
export function fetchResults(page: number) {
  return api<Page<ResultDetail>>(`/results/?page=${page}&page_size=${PAGE_SIZE}`);
}

/** Every attempt I made, finished or not (newest first). */
export function fetchHistory(page: number) {
  return api<Page<HistoryItem>>(`/attempts/?page=${page}&page_size=${PAGE_SIZE}`);
}

/** 403 `result_not_visible` while the exam's results are not out yet. */
export function fetchResult(attemptId: string) {
  return api<ResultDetail>(`/results/${encodeURIComponent(attemptId)}/`);
}

/** Correct answers and explanations — only when the server allows review
 * (403 `review_not_allowed` / `result_not_visible` otherwise). */
export function fetchReview(attemptId: string) {
  return api<Review>(`/results/${encodeURIComponent(attemptId)}/review/`);
}

/** The exam's generated merit list (404 `merit_disabled`, 403 `result_not_visible`). */
export function fetchLeaderboard(slug: string, page: number) {
  return api<LeaderboardPage>(`/exams/${encodeURIComponent(slug)}/leaderboard/?page=${page}&page_size=50`);
}
