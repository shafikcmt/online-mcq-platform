import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const router = { push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() };
vi.mock("next/navigation", () => ({
  useRouter: () => router,
  usePathname: () => window.location.pathname,
  useSearchParams: () => new URLSearchParams(window.location.search),
}));

import { AnnouncementsView } from "@/components/cms/announcements-view";
import { FaqsView } from "@/components/cms/faqs-view";
import { PagesView } from "@/components/cms/pages-view";
import { ANNOUNCEMENT_LIST, FAQ_LIST, PAGE_LIST } from "@/lib/content-specs";
import { parseListParams, type ListSpec } from "@/lib/list-params";
import type { Announcement, CmsPage, Faq } from "@/types/cms";

import { apiError, json, mockApi, page, renderPanel } from "./content-helpers";

const STAMP = "2026-10-01T08:00:00Z";

function announcement(overrides: Partial<Announcement> = {}): Announcement {
  return {
    id: 1,
    title_bn: "পরীক্ষার সময়সূচি",
    title_en: "Exam schedule",
    body_bn: "বিস্তারিত",
    body_en: "Details",
    audience: "all",
    is_pinned: false,
    published_at: "2026-10-01T04:00:00Z",
    expires_at: null,
    state: "live",
    created_at: STAMP,
    updated_at: STAMP,
    ...overrides,
  };
}

const faq = (overrides: Partial<Faq> = {}): Faq => ({
  id: 3,
  question_bn: "কীভাবে নিবন্ধন করব?",
  question_en: "How do I register?",
  answer_bn: "অ্যাপে।",
  answer_en: "In the app.",
  is_active: true,
  sort_order: 2,
  created_at: STAMP,
  updated_at: STAMP,
  ...overrides,
});

const cmsPage = (overrides: Partial<CmsPage> = {}): CmsPage => ({
  id: 5,
  slug: "about",
  title_bn: "আমাদের সম্পর্কে",
  title_en: "About us",
  body_bn: "লেখা",
  body_en: "Text",
  is_active: true,
  created_at: STAMP,
  updated_at: STAMP,
  ...overrides,
});

function state(path: string, spec: ListSpec, query = "") {
  window.history.replaceState({}, "", `${path}${query ? `?${query}` : ""}`);
  return parseListParams(new URLSearchParams(query), spec);
}

const bodyRows = () => within(screen.getByRole("table")).getAllByRole("row").slice(1);
const lastQuery = () => new URL(String(router.push.mock.lastCall?.[0]), "http://x").searchParams;

beforeEach(() => {
  router.push.mockReset();
  router.replace.mockReset();
});
afterEach(() => vi.restoreAllMocks());

describe("AnnouncementsView", () => {
  const view = (rows: Announcement[] = [announcement()], query = "", locale: "en" | "bn" = "en") =>
    renderPanel(<AnnouncementsView data={page(rows)} state={state("/announcements", ANNOUNCEMENT_LIST, query)} />, locale);

  it("rows show the server's state, the audience, pin and the publish window", () => {
    view([
      announcement({ is_pinned: true }),
      announcement({ id: 2, title_en: "Draft notice", title_bn: "", state: "draft", published_at: null, audience: "students" }),
      announcement({ id: 3, title_en: "Later", state: "scheduled", audience: "public", published_at: "2030-01-01T00:00:00Z" }),
      announcement({ id: 4, title_en: "Old", state: "expired", expires_at: "2026-10-02T00:00:00Z" }),
    ]);
    const [live, draft, scheduled, ended] = bodyRows();
    expect(live).toHaveTextContent("Exam schedule");
    expect(live).toHaveTextContent("পরীক্ষার সময়সূচি");
    expect(within(live).getByLabelText("Pinned")).toBeInTheDocument();
    expect(live).toHaveTextContent("Live");
    expect(live).toHaveTextContent("Everyone");
    expect(live).toHaveTextContent("1 Oct 2026");
    expect(draft).toHaveTextContent("Draft");
    expect(draft).toHaveTextContent("Students (app)");
    expect(draft).toHaveTextContent("—");
    expect(scheduled).toHaveTextContent("Scheduled");
    expect(scheduled).toHaveTextContent("Website");
    expect(ended).toHaveTextContent("Ended");
  });

  it("filters and search go to the URL", () => {
    view();
    fireEvent.change(screen.getAllByLabelText("Shown to")[0], { target: { value: "students" } });
    expect(lastQuery().get("audience")).toBe("students");
    fireEvent.change(screen.getAllByLabelText("Publication")[0], { target: { value: "false" } });
    expect(lastQuery().get("published")).toBe("false");
    fireEvent.change(screen.getAllByLabelText("Pinned")[0], { target: { value: "true" } });
    expect(lastQuery().get("is_pinned")).toBe("true");
  });

  it("create: bilingual pair, audience, pin, Bangladesh-time window (empty = draft / no end)", async () => {
    const { calls } = mockApi((call) => (call.method === "POST" ? json(201, announcement({ id: 9 })) : json(200, page([announcement()]))));
    view();
    fireEvent.click(screen.getByRole("button", { name: "New announcement" }));
    const dialog = await screen.findByRole("dialog", { name: "New announcement" });
    fireEvent.change(within(dialog).getAllByLabelText(/English/)[0], { target: { value: "Holiday" } });
    fireEvent.change(within(dialog).getAllByLabelText(/English/)[1], { target: { value: "Closed on Friday." } });
    fireEvent.change(within(dialog).getByLabelText("Shown to"), { target: { value: "students" } });
    fireEvent.click(within(dialog).getByRole("switch", { name: /Pin to the top/ }));
    fireEvent.change(within(dialog).getByLabelText(/Publish at/), { target: { value: "2026-11-01T09:00" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Create" }));
    expect(await screen.findByText("Announcement created.")).toBeInTheDocument();
    const post = calls.find((call) => call.method === "POST")!;
    expect(post.url).toBe("/api/v1/admin/announcements/");
    expect(post.body).toEqual({
      title_bn: "",
      title_en: "Holiday",
      body_bn: "",
      body_en: "Closed on Friday.",
      audience: "students",
      is_pinned: true,
      published_at: "2026-11-01T09:00:00+06:00",
      expires_at: null,
    });
  });

  it("server field errors (pair rule, window) appear under their fields", async () => {
    mockApi(() =>
      apiError(400, "validation_error", "Invalid.", {
        body_en: ["Fill in both title and body for this language, or neither."],
        expires_at: ["The end time must be after the publish time."],
      }),
    );
    view();
    fireEvent.click(within(screen.getByRole("table")).getByRole("button", { name: "Edit Exam schedule" }));
    const dialog = await screen.findByRole("dialog", { name: "Edit announcement" });
    expect(within(dialog).getAllByLabelText(/English/)[0]).toHaveValue("Exam schedule");
    expect(within(dialog).getByLabelText(/Publish at/)).toHaveValue("2026-10-01T10:00"); // 04:00 UTC = 10:00 Dhaka
    fireEvent.click(within(dialog).getByRole("button", { name: "Save changes" }));
    expect(await within(dialog).findByText("Fill in both title and body for this language, or neither.")).toBeInTheDocument();
    expect(within(dialog).getByText("The end time must be after the publish time.")).toBeInTheDocument();
    expect(within(dialog).getByLabelText(/End at/)).toHaveAttribute("aria-invalid", "true");
  });

  it("edit sends PATCH; delete asks first, then reloads", async () => {
    const { calls } = mockApi((call) => (call.method === "GET" ? json(200, page([announcement()])) : call.method === "DELETE" ? json(204, undefined) : json(200, announcement())));
    view();
    fireEvent.click(within(screen.getByRole("table")).getByRole("button", { name: "Edit Exam schedule" }));
    const dialog = await screen.findByRole("dialog", { name: "Edit announcement" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save changes" }));
    expect(await screen.findByText("Announcement saved.")).toBeInTheDocument();
    expect(calls.find((call) => call.method === "PATCH")!.url).toBe("/api/v1/admin/announcements/1/");
    fireEvent.click(within(screen.getByRole("table")).getByRole("button", { name: "Delete Exam schedule" }));
    const confirm = await screen.findByRole("alertdialog", { name: "Delete this announcement?" });
    expect(calls.filter((call) => call.method === "DELETE")).toHaveLength(0);
    fireEvent.click(within(confirm).getByRole("button", { name: "Delete" }));
    expect(await screen.findByText("Announcement deleted.")).toBeInTheDocument();
    expect(calls.find((call) => call.method === "DELETE")!.url).toBe("/api/v1/admin/announcements/1/");
    await waitFor(() => expect(calls.filter((call) => call.method === "GET").length).toBeGreaterThan(0));
  });

  it("empty and Bangla", () => {
    const { unmount } = view([]);
    expect(screen.getByText("No announcements yet")).toBeInTheDocument();
    unmount();
    view([announcement()], "", "bn");
    expect(screen.getByRole("heading", { level: 1, name: "ঘোষণা" })).toBeInTheDocument();
    expect(bodyRows()[0]).toHaveTextContent("চালু");
  });
});

describe("FaqsView", () => {
  const view = (rows: Faq[] = [faq()]) => renderPanel(<FaqsView data={page(rows)} state={state("/faqs", FAQ_LIST)} />);

  it("rows: question, sort order, active state", () => {
    view([faq(), faq({ id: 4, question_en: "Refunds?", is_active: false })]);
    expect(bodyRows()[0]).toHaveTextContent("How do I register?");
    expect(bodyRows()[0]).toHaveTextContent("2");
    expect(bodyRows()[1]).toHaveTextContent("Inactive");
  });

  it("create sends the question/answer pair, sort order and active flag", async () => {
    const { calls } = mockApi((call) => (call.method === "POST" ? json(201, faq({ id: 8 })) : json(200, page([faq()]))));
    view();
    fireEvent.click(screen.getByRole("button", { name: "New question" }));
    const dialog = await screen.findByRole("dialog", { name: "New question" });
    fireEvent.change(within(dialog).getAllByLabelText(/Bangla/)[0], { target: { value: "প্রশ্ন?" } });
    fireEvent.change(within(dialog).getAllByLabelText(/Bangla/)[1], { target: { value: "উত্তর।" } });
    fireEvent.change(within(dialog).getByLabelText(/Sort order/), { target: { value: "5" } });
    fireEvent.click(within(dialog).getByRole("switch", { name: /Active/ }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Create" }));
    expect(await screen.findByText("Question added.")).toBeInTheDocument();
    expect(calls.find((call) => call.method === "POST")!.body).toEqual({
      question_bn: "প্রশ্ন?",
      question_en: "",
      answer_bn: "উত্তর।",
      answer_en: "",
      is_active: false,
      sort_order: 5,
    });
  });
});

describe("PagesView", () => {
  const view = (rows: CmsPage[] = [cmsPage()]) => renderPanel(<PagesView data={page(rows)} state={state("/pages", PAGE_LIST)} />);

  it("rows show the public address", () => {
    view();
    expect(bodyRows()[0]).toHaveTextContent("About us");
    expect(bodyRows()[0]).toHaveTextContent("/pages/about");
  });

  it("slug errors from the server appear under the slug", async () => {
    const { calls } = mockApi(() => apiError(400, "validation_error", "Invalid.", { slug: ["A page with this slug already exists."] }));
    view();
    fireEvent.click(screen.getByRole("button", { name: "New page" }));
    const dialog = await screen.findByRole("dialog", { name: "New page" });
    fireEvent.change(within(dialog).getByLabelText(/Slug/), { target: { value: " about " } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Create" }));
    expect(await within(dialog).findByText("A page with this slug already exists.")).toBeInTheDocument();
    expect((calls[0].body as { slug: string }).slug).toBe("about");
  });
});
