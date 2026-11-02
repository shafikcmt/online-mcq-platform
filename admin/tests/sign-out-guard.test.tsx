import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const router = { push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() };
vi.mock("next/navigation", () => ({
  useRouter: () => router,
  usePathname: () => "/exams/7",
  useSearchParams: () => new URLSearchParams(),
}));

import { ExamEditor } from "@/components/exams/exam-editor";
import { AppShell } from "@/components/shell/app-shell";
import type { Locale } from "@/lib/i18n/messages";

import { category, exam, examRow, json, mockApi, subject } from "./content-helpers";
import { renderWithI18n } from "./helpers";

/** Sign out is a top-bar button, not a link: it asks the exam editor's unsaved-changes
 * guard (through the shell's leave-guard context) before running the normal logout. */
const profile = { full_name: "Nusrat Jahan", mobile_number: "017*****678", preferred_language: "en", role: "admin" };
const editor = <ExamEditor exam={exam()} questions={[examRow(1, 0), examRow(2, 1)]} categories={[category()]} subjects={[subject()]} lookupTruncated={false} />;

function renderShell(children = editor, locale: Locale = "en") {
  return renderWithI18n(<AppShell profile={profile}>{children}</AppShell>, locale);
}

async function chooseSignOut(label = "Sign out", menu = "Account menu") {
  await userEvent.click(screen.getByRole("button", { name: menu }));
  await userEvent.click(await screen.findByRole("menuitem", { name: label }));
}

const logoutCalls = (calls: { url: string; method: string }[]) =>
  calls.filter((call) => call.method === "POST" && call.url === "/api/v1/admin/auth/logout/");

beforeEach(() => {
  router.replace.mockReset();
  router.refresh.mockReset();
  router.push.mockReset();
});

describe("Sign out with unsaved exam changes", () => {
  it("asks first; Keep editing is focused and keeps every unsaved value", async () => {
    const { calls } = mockApi(() => json(204, undefined));
    renderShell();
    fireEvent.change(screen.getByLabelText(/^Duration/), { target: { value: "55" } });
    fireEvent.click(screen.getByRole("button", { name: "Move question #2 up" })); // question list dirty too
    await chooseSignOut();
    const dialog = await screen.findByRole("alertdialog", { name: "Discard unsaved changes?" });
    expect(within(dialog).getByRole("button", { name: "Discard and sign out" })).toBeInTheDocument();
    await waitFor(() => expect(within(dialog).getByRole("button", { name: "Keep editing" })).toHaveFocus());
    expect(logoutCalls(calls)).toHaveLength(0); // nothing happened yet

    await userEvent.click(within(dialog).getByRole("button", { name: "Keep editing" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    expect(screen.getByLabelText(/^Duration/)).toHaveValue(55);
    const order = screen.getAllByRole("listitem").map((item) => item.getAttribute("data-question-row")).filter(Boolean);
    expect(order).toEqual(["2", "1"]);
    expect(screen.getAllByText("Unsaved changes").length).toBeGreaterThan(0);
    expect(logoutCalls(calls)).toHaveLength(0);
    expect(router.replace).not.toHaveBeenCalled();
  });

  it("Discard and sign out runs the existing logout flow once", async () => {
    const { calls } = mockApi(() => json(204, undefined));
    renderShell();
    fireEvent.change(screen.getByLabelText(/^Duration/), { target: { value: "55" } });
    await chooseSignOut();
    const dialog = await screen.findByRole("alertdialog", { name: "Discard unsaved changes?" });
    await userEvent.click(within(dialog).getByRole("button", { name: "Discard and sign out" }));
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/login"));
    expect(logoutCalls(calls)).toHaveLength(1);
    expect(router.refresh).toHaveBeenCalled();
    expect(router.push).not.toHaveBeenCalled(); // no page navigation of its own
  });

  it("a clean exam signs out at once, without a question", async () => {
    const { calls } = mockApi(() => json(204, undefined));
    renderShell();
    await chooseSignOut();
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/login"));
    expect(logoutCalls(calls)).toHaveLength(1);
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it("other pages (no editor) sign out exactly as before", async () => {
    const { calls } = mockApi(() => json(204, undefined));
    renderShell(<p>Dashboard</p>);
    await chooseSignOut();
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/login"));
    expect(logoutCalls(calls)).toHaveLength(1);
  });

  it("once the dirty editor is gone, Sign out no longer asks", async () => {
    const { calls } = mockApi(() => json(204, undefined));
    const view = renderShell();
    fireEvent.change(screen.getByLabelText(/^Duration/), { target: { value: "55" } });
    view.rerender(<AppShell profile={profile}><p>Another page</p></AppShell>);
    await chooseSignOut();
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/login"));
    expect(logoutCalls(calls)).toHaveLength(1);
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it("links still say Discard changes (the sign-out wording is only for Sign out)", async () => {
    mockApi(() => json(204, undefined));
    renderShell();
    fireEvent.change(screen.getByLabelText(/^Duration/), { target: { value: "55" } });
    fireEvent.click(screen.getByRole("link", { name: "Back to exams" }));
    const dialog = await screen.findByRole("alertdialog", { name: "Discard unsaved changes?" });
    expect(within(dialog).getByRole("button", { name: "Discard changes" })).toBeInTheDocument();
    expect(within(dialog).queryByRole("button", { name: "Discard and sign out" })).not.toBeInTheDocument();
  });

  it("Bangla: the confirmation and its actions are translated", async () => {
    mockApi(() => json(204, undefined));
    renderShell(editor, "bn");
    fireEvent.change(screen.getByLabelText(/^সময়কাল/), { target: { value: "55" } });
    await chooseSignOut("সাইন আউট", "অ্যাকাউন্ট মেনু");
    const dialog = await screen.findByRole("alertdialog", { name: "সংরক্ষণ না করা পরিবর্তন বাদ দেবেন?" });
    expect(within(dialog).getByRole("button", { name: "বাদ দিয়ে সাইন আউট করুন" })).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "সম্পাদনা চালিয়ে যান" })).toBeInTheDocument();
  });
});
