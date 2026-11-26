import { render } from "@testing-library/react";
import type { ReactElement, ReactNode } from "react";
import { vi } from "vitest";

import { ToastProvider } from "@/components/ui/toast";
import { I18nProvider } from "@/lib/i18n/provider";
import type { Locale } from "@/lib/i18n/messages";
import type { Category, ExamGroup, Paginated, Question, Subject } from "@/types/content";
import type { Exam, ExamQuestionRow } from "@/types/exams";
import type { AdminResult } from "@/types/results";

/** Render inside the providers the panel layout supplies (language + toasts). */
export function renderPanel(ui: ReactElement, locale: Locale = "en") {
  return render(ui, {
    wrapper: ({ children }: { children: ReactNode }) => (
      <I18nProvider locale={locale}>
        <ToastProvider>{children}</ToastProvider>
      </I18nProvider>
    ),
  });
}

export function json(status: number, body: unknown) {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: body === undefined ? {} : { "content-type": "application/json" },
  });
}

export function apiError(status: number, code: string, message: string, fieldErrors?: Record<string, unknown>) {
  return json(status, { error: { code, message, details: {}, ...(fieldErrors ? { field_errors: fieldErrors } : {}) } });
}

type Call = { method: string; url: string; body: unknown; headers: Record<string, string> };

/** Stub `fetch` (the real apiFetch runs, so headers, CSRF and error parsing are exercised).
 * `handler` answers each request; every request is recorded in `calls`. */
export function mockApi(handler: (call: Call) => Response | Promise<Response>) {
  document.cookie = "csrftoken=test-token; path=/";
  const calls: Call[] = [];
  const spy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const body = init?.body;
    const call = {
      method: (init?.method ?? "GET").toUpperCase(),
      url: String(input),
      body: typeof body === "string" ? JSON.parse(body) : body,
      headers: { ...(init?.headers as Record<string, string> | undefined) },
    };
    calls.push(call);
    return handler(call);
  });
  return { calls, spy };
}

export function page<T>(results: T[], count = results.length): Paginated<T> {
  return { count, next: null, previous: null, results };
}

const STAMP = "2026-10-01T08:00:00Z";

export function category(overrides: Partial<Category> = {}): Category {
  return {
    id: 1,
    name_bn: "এইচএসসি",
    name_en: "HSC",
    slug: "hsc",
    description_bn: "",
    description_en: "",
    sort_order: 0,
    is_active: true,
    subject_count: 2,
    created_at: STAMP,
    updated_at: STAMP,
    ...overrides,
  };
}

export function group(overrides: Partial<ExamGroup> = {}): ExamGroup {
  return {
    id: 30,
    category: 1,
    parent: null,
    name_bn: "বিসিএস প্রস্তুতি",
    name_en: "BCS prep",
    slug: "bcs-prep",
    description_bn: "",
    description_en: "",
    sort_order: 0,
    is_active: true,
    exam_count: 2,
    child_count: 0,
    created_at: STAMP,
    updated_at: STAMP,
    ...overrides,
  };
}

export function subject(overrides: Partial<Subject> = {}): Subject {
  return {
    id: 10,
    category: 1,
    name_bn: "পদার্থবিজ্ঞান",
    name_en: "Physics",
    slug: "physics",
    description_bn: "",
    description_en: "",
    sort_order: 0,
    is_active: true,
    created_at: STAMP,
    updated_at: STAMP,
    ...overrides,
  };
}

export function question(overrides: Partial<Question> = {}): Question {
  return {
    id: 100,
    subject: 10,
    category: 1,
    text_bn: "আলোর বেগ কত?",
    text_en: "What is the speed of light?",
    explanation_bn: "",
    explanation_en: "",
    chapter: "",
    topic: "",
    difficulty: "medium",
    is_active: true,
    available_languages: "both",
    image: null,
    options: [
      { id: 1, text_bn: "ক", text_en: "A", is_correct: false, sort_order: 0 },
      { id: 2, text_bn: "খ", text_en: "B", is_correct: true, sort_order: 1 },
      { id: 3, text_bn: "গ", text_en: "C", is_correct: false, sort_order: 2 },
    ],
    created_by: 1,
    created_at: STAMP,
    updated_at: STAMP,
    ...overrides,
  };
}

/** The toast region's latest message (the list's own busy status is also a `status`). */
export async function findToast() {
  const { screen, within } = await import("@testing-library/react");
  return within(screen.getByRole("region", { name: "Notification", hidden: true })).findByRole("status", { hidden: true });
}

export function exam(overrides: Partial<Exam> = {}): Exam {
  return {
    id: 7,
    public_id: "00000000-0000-0000-0000-000000000007",
    slug: "model-test",
    status: "draft",
    title_bn: "মডেল টেস্ট",
    title_en: "Model test",
    description_bn: "",
    description_en: "",
    instructions_bn: "",
    instructions_en: "",
    content_language: "bn",
    category: 1,
    subject: 10,
    group: null,
    exam_type: "regular",
    access_type: "free",
    duration_minutes: 30,
    total_questions: 3,
    default_marks: "1.00",
    negative_marks: "0.00",
    pass_marks: null,
    start_at: null,
    end_at: null,
    shuffle_questions: false,
    shuffle_options: false,
    allow_retake: false,
    max_attempts: 1,
    merit_enabled: true,
    merit_strategy: "first_attempt",
    result_visibility: "immediate",
    allow_answer_review: true,
    is_featured: false,
    result_published_at: null,
    results_visible: true,
    question_count: 2,
    total_marks: "2.00",
    created_by: 1,
    created_at: STAMP,
    updated_at: STAMP,
    ...overrides,
  };
}

export function examRow(id: number, sortOrder: number, overrides: Partial<ExamQuestionRow> = {}): ExamQuestionRow {
  return {
    question: id,
    sort_order: sortOrder,
    marks: null,
    effective_marks: "1.00",
    subject: 10,
    available_languages: "both",
    is_active: true,
    text_bn: `প্রশ্ন ${id}`,
    text_en: `Question ${id}`,
    ...overrides,
  };
}

export function adminResult(overrides: Partial<AdminResult> = {}): AdminResult {
  return {
    attempt_id: "6f1c2b9e-1d2a-4c3b-8e4f-5a6b7c8d9e01",
    attempt_no: 1,
    exam_id: 7,
    exam_title_bn: "মডেল টেস্ট",
    exam_title_en: "Model test",
    user_id: 40,
    user_full_name: "Ayesha Siddika",
    status: "submitted",
    submit_source: "manual",
    submitted_at: "2026-10-01T08:00:00Z",
    correct_count: 2,
    wrong_count: 0,
    unanswered_count: 1,
    obtained_marks: "2.00",
    total_marks: "3.00",
    percentage: "66.67",
    is_passed: true,
    time_used_seconds: 754,
    is_merit_counted: true,
    merit_position: 2,
    ...overrides,
  };
}
