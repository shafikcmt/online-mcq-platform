import { render } from "@testing-library/react";
import type { ReactElement, ReactNode } from "react";
import { vi } from "vitest";

import { ToastProvider } from "@/components/ui/toast";
import { I18nProvider } from "@/lib/i18n/provider";
import type { Locale } from "@/lib/i18n/messages";
import type { Category, Paginated, Question, Subject } from "@/types/content";

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

type Call = { method: string; url: string; body: unknown };

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
