import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const router = { push: vi.fn(), replace: vi.fn(), refresh: vi.fn() };
vi.mock("next/navigation", () => ({
  useRouter: () => router,
  usePathname: () => window.location.pathname,
  useSearchParams: () => new URLSearchParams(window.location.search),
}));
vi.mock("@/lib/session", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/session")>()),
  navigateTo: vi.fn(),
}));

import { CategoriesView } from "@/components/content/categories-view";
import { QuestionForm } from "@/components/content/question-form";
import { QuestionImage } from "@/components/content/question-image";
import { SubjectsView } from "@/components/content/subjects-view";
import { SessionExpiredDialog } from "@/components/shell/session-expired";
import { apiFetch } from "@/lib/api/client";
import { CATEGORY_LIST, SUBJECT_LIST } from "@/lib/content-specs";
import { parseListParams } from "@/lib/list-params";
import { SESSION_EXPIRED_EVENT, expiredLoginPath, navigateTo, safeNextPath } from "@/lib/session";

import { apiError, category, mockApi, page, question, renderPanel, subject } from "./content-helpers";

const expired = () => apiError(401, "not_authenticated", "Authentication credentials were not provided.");
const SESSION_TEXT = "Your session has ended. Please sign in again.";

beforeEach(() => {
  vi.mocked(navigateTo).mockReset();
  router.refresh.mockReset();
});
afterEach(() => window.history.pushState({}, "", "/"));

/** The shell's dialog is shown, and "Sign in again" goes to sign-in returning here. */
async function expectSignInOffered(next: string) {
  const dialog = await screen.findByRole("alertdialog", { name: "Your session has ended" });
  fireEvent.click(within(dialog).getByRole("button", { name: "Sign in again" }));
  expect(navigateTo).toHaveBeenCalledWith(`/login?expired=1&next=${encodeURIComponent(next)}`);
}

describe("safe sign-in redirects", () => {
  it("accepts same-site paths and rejects everything else", () => {
    expect(safeNextPath("/questions/12?tab=1")).toBe("/questions/12?tab=1");
    for (const bad of ["https://evil.example", "//evil.example", "/\\evil.example", "/login?next=/x", "javascript:alert(1)", "", null, "/a\nb"]) {
      expect(safeNextPath(bad)).toBe("/dashboard");
    }
    expect(expiredLoginPath("/subjects?category=2")).toBe("/login?expired=1&next=%2Fsubjects%3Fcategory%3D2");
    expect(expiredLoginPath("/login")).toBe("/login?expired=1"); // no loop
  });
});

describe("apiFetch session signal", () => {
  it("signals 401 on admin APIs, but not wrong-password 401 or other errors", async () => {
    const seen = vi.fn();
    window.addEventListener(SESSION_EXPIRED_EVENT, seen);
    let response = expired;
    mockApi(() => response());
    await expect(apiFetch("/admin/categories/", { method: "POST", body: {} })).rejects.toMatchObject({ status: 401 });
    expect(seen).toHaveBeenCalledTimes(1);
    response = () => apiError(401, "invalid_credentials", "Wrong mobile number or password.");
    await expect(apiFetch("/admin/auth/login/", { method: "POST", body: {} })).rejects.toMatchObject({ status: 401 });
    response = () => apiError(409, "in_use", "In use.");
    await expect(apiFetch("/admin/categories/1/", { method: "DELETE" })).rejects.toMatchObject({ status: 409 });
    response = () => apiError(400, "validation_error", "x", { slug: ["Taken"] });
    await expect(apiFetch("/admin/categories/", { method: "POST", body: {} })).rejects.toMatchObject({ status: 400 });
    expect(seen).toHaveBeenCalledTimes(1);
    window.removeEventListener(SESSION_EXPIRED_EVENT, seen);
  });
});

describe("session expiry during saves keeps the input and offers sign-in", () => {
  it("category save → 401", async () => {
    window.history.pushState({}, "", "/categories?page=2");
    mockApi(expired);
    renderPanel(
      <>
        <CategoriesView data={page([category()], 21)} state={parseListParams({ page: "2" }, CATEGORY_LIST)} />
        <SessionExpiredDialog />
      </>,
    );
    fireEvent.click(screen.getAllByRole("button", { name: "New category" })[0]);
    const form = await screen.findByRole("dialog", { name: "New category" });
    const english = within(within(form).getByRole("group", { name: /^Name/ })).getByLabelText("English");
    fireEvent.change(english, { target: { value: "Unsaved name" } });
    fireEvent.click(within(form).getByRole("button", { name: "Create" }));
    await expectSignInOffered("/categories?page=2");
    expect(english).toHaveValue("Unsaved name"); // nothing lost before the message
    expect(within(form).getByText(SESSION_TEXT)).toBeInTheDocument();
    expect(router.refresh).not.toHaveBeenCalled();
  });

  it("subject save → 401", async () => {
    window.history.pushState({}, "", "/subjects");
    mockApi(expired);
    renderPanel(
      <>
        <SubjectsView data={page([subject()])} state={parseListParams({}, SUBJECT_LIST)} categories={[category()]} categoriesTruncated={false} />
        <SessionExpiredDialog />
      </>,
    );
    fireEvent.click(within(screen.getByRole("table")).getByRole("button", { name: "Edit Physics" }));
    const form = await screen.findByRole("dialog", { name: "Edit subject" });
    fireEvent.click(within(form).getByRole("button", { name: "Save changes" }));
    await expectSignInOffered("/subjects");
  });

  it("question save → 401", async () => {
    window.history.pushState({}, "", "/questions/100");
    mockApi(expired);
    renderPanel(
      <>
        <QuestionForm question={question()} categories={[category()]} initialSubjects={[subject()]} />
        <SessionExpiredDialog />
      </>,
    );
    const text = screen.getByLabelText("English", { selector: "#q-text_en" });
    fireEvent.change(text, { target: { value: "Edited but unsaved" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await expectSignInOffered("/questions/100");
    expect(text).toHaveValue("Edited but unsaved");
  });

  it("image upload → 401 and image remove → 401", async () => {
    window.history.pushState({}, "", "/questions/100");
    mockApi(expired);
    renderPanel(
      <>
        <QuestionImage question={question({ image: "/media/q.png" })} onChange={vi.fn()} />
        <SessionExpiredDialog />
      </>,
    );
    fireEvent.change(screen.getByLabelText("Image file"), {
      target: { files: [new File(["x"], "q.png", { type: "image/png" })] },
    });
    expect(await screen.findByText(SESSION_TEXT)).toBeInTheDocument();
    await expectSignInOffered("/questions/100");

    vi.mocked(navigateTo).mockReset();
    fireEvent.click(screen.getByRole("button", { name: "Stay on this page" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Remove image" }));
    const confirm = await screen.findByRole("alertdialog", { name: "Remove the image?" });
    fireEvent.click(within(confirm).getByRole("button", { name: "Remove image" }));
    await expectSignInOffered("/questions/100");
  });

  it("a validation error does not offer sign-in", async () => {
    mockApi(() => apiError(400, "validation_error", "x", { slug: ["Taken."] }));
    renderPanel(
      <>
        <CategoriesView data={page([category()])} state={parseListParams({}, CATEGORY_LIST)} />
        <SessionExpiredDialog />
      </>,
    );
    fireEvent.click(screen.getAllByRole("button", { name: "New category" })[0]);
    const form = await screen.findByRole("dialog", { name: "New category" });
    fireEvent.click(within(form).getByRole("button", { name: "Create" }));
    expect(await within(form).findByText("Taken.")).toBeInTheDocument();
    expect(screen.queryByRole("alertdialog", { name: "Your session has ended" })).not.toBeInTheDocument();
  });
});
