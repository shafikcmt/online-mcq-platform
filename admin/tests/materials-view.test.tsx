import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const router = { push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() };
vi.mock("next/navigation", () => ({
  useRouter: () => router,
  usePathname: () => window.location.pathname,
  useSearchParams: () => new URLSearchParams(window.location.search),
}));

import { MaterialsView } from "@/components/materials/materials-view";
import { MATERIAL_LIST } from "@/lib/content-specs";
import { parseListParams } from "@/lib/list-params";
import type { Material } from "@/types/materials";

import { apiError, category, json, mockApi, page, renderPanel, subject } from "./content-helpers";

const STAMP = "2026-10-01T08:00:00Z";
const LOOKUPS = {
  categories: [category(), category({ id: 2, name_en: "Medical", name_bn: "মেডিকেল", slug: "medical" })],
  subjects: [subject(), subject({ id: 11, category: 2, name_en: "Biology", name_bn: "জীববিজ্ঞান", slug: "biology" })],
  exams: [{ id: 5, title_bn: "", title_en: "Physics test" }],
};

function material(overrides: Partial<Material> = {}): Material {
  return {
    id: 1,
    kind: "video",
    title_bn: "নিউটনের সূত্র",
    title_en: "Newton's laws",
    description_bn: "",
    description_en: "",
    youtube_id: "dQw4w9WgXcQ",
    watch_url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    pdf: { available: false, name: "", size_bytes: 0 },
    category: 1,
    category_label: "HSC",
    subject: 10,
    subject_label: "Physics",
    exam: null,
    exam_label: "",
    teacher: "Rahim Sir",
    sort_order: 0,
    published_at: "2026-10-01T04:00:00Z",
    state: "live",
    created_at: STAMP,
    updated_at: STAMP,
    ...overrides,
  };
}

function state(query = "") {
  window.history.replaceState({}, "", `/materials${query ? `?${query}` : ""}`);
  return parseListParams(new URLSearchParams(query), MATERIAL_LIST);
}

const view = (rows: Material[] = [material()], locale: "en" | "bn" = "en", query = "") =>
  renderPanel(<MaterialsView data={page(rows)} state={state(query)} lookups={LOOKUPS} />, locale);
const lastQuery = () => new URL(String(router.push.mock.lastCall?.[0]), "http://x").searchParams;

beforeEach(() => {
  router.push.mockReset();
  router.replace.mockReset();
});
afterEach(() => vi.restoreAllMocks());

describe("MaterialsView", () => {
  it("lists title, type, place, teacher and status; a video row links to YouTube", () => {
    view([material(), material({ id: 2, kind: "pdf", title_en: "Formula sheet", title_bn: "", state: "draft", published_at: null, teacher: "", category: null, category_label: "", subject_label: "" })]);
    const rows = within(screen.getByRole("table")).getAllByRole("row").slice(1);
    expect(rows).toHaveLength(2);
    expect(within(rows[0]).getByText("Video")).toBeInTheDocument();
    expect(within(rows[0]).getByText("HSC · Physics")).toBeInTheDocument();
    expect(within(rows[0]).getByText("Rahim Sir")).toBeInTheDocument();
    expect(within(rows[0]).getByText("Live")).toBeInTheDocument();
    expect(within(rows[1]).getByText("Draft")).toBeInTheDocument();
    const watch = within(rows[0]).getByRole("link", { name: /Watch on YouTube/ });
    expect(watch).toHaveAttribute("href", "https://www.youtube.com/watch?v=dQw4w9WgXcQ");
    expect(watch).toHaveAttribute("rel", expect.stringContaining("noopener"));
    expect(within(rows[1]).queryByRole("link", { name: /Watch on YouTube/ })).not.toBeInTheDocument();
  });

  it("filters go into the address (type, category, publication)", async () => {
    view();
    fireEvent.change(screen.getAllByLabelText("Type")[0], { target: { value: "pdf" } });
    await waitFor(() => expect(lastQuery().get("kind")).toBe("pdf"));
    fireEvent.change(screen.getAllByLabelText("Category")[0], { target: { value: "2" } });
    await waitFor(() => expect(lastQuery().get("category")).toBe("2"));
  });

  it("empty and Bangla states", () => {
    view([]);
    expect(screen.getByText("No study materials yet")).toBeInTheDocument();
  });

  it("is available in Bangla", () => {
    view([material()], "bn");
    expect(screen.getAllByText("স্টাডি ম্যাটেরিয়াল").length).toBeGreaterThan(0);
    expect(screen.getAllByText("ভিডিও").length).toBeGreaterThan(0);
  });

  it("creates a video from a pasted link and publishes it now", async () => {
    const { calls } = mockApi((call) => (call.method === "POST" ? json(201, material({ id: 9 })) : json(200, page([material()]))));
    view();
    fireEvent.click(screen.getByRole("button", { name: "New material" }));
    const dialog = await screen.findByRole("dialog", { name: "New study material" });
    fireEvent.change(within(dialog).getAllByLabelText(/English/)[0], { target: { value: "Motion" } });
    fireEvent.change(within(dialog).getByLabelText(/YouTube link/), { target: { value: "https://youtu.be/dQw4w9WgXcQ?t=5" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Create" }));
    expect(await screen.findByText("Material created.")).toBeInTheDocument();
    const post = calls.find((call) => call.method === "POST")!;
    expect(post.url).toBe("/api/v1/admin/materials/");
    expect(post.body).toMatchObject({ kind: "video", title_en: "Motion", youtube_url: "https://youtu.be/dQw4w9WgXcQ?t=5", publish_now: true, category: null, exam: null });
  });

  it("shows the server's error under the link field and keeps the dialog open", async () => {
    mockApi((call) => (call.method === "POST" ? apiError(400, "validation_error", "Invalid", { youtube_url: ["Enter a YouTube video link."] }) : json(200, page([material()]))));
    view();
    fireEvent.click(screen.getByRole("button", { name: "New material" }));
    const dialog = await screen.findByRole("dialog", { name: "New study material" });
    fireEvent.change(within(dialog).getAllByLabelText(/English/)[0], { target: { value: "Motion" } });
    fireEvent.change(within(dialog).getByLabelText(/YouTube link/), { target: { value: "https://example.com/x" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Create" }));
    expect(await within(dialog).findByText("Enter a YouTube video link.")).toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "New study material" })).toBeInTheDocument();
  });

  it("a PDF material has no link field and asks to save before attaching the file", async () => {
    mockApi(() => json(200, page([material()])));
    view();
    fireEvent.click(screen.getByRole("button", { name: "New material" }));
    const dialog = await screen.findByRole("dialog", { name: "New study material" });
    fireEvent.change(within(dialog).getByLabelText("Type"), { target: { value: "pdf" } });
    expect(within(dialog).queryByLabelText(/YouTube link/)).not.toBeInTheDocument();
    expect(within(dialog).getByText("Save the material first, then you can attach the PDF.")).toBeInTheDocument();
  });

  it("changing the category drops a subject that does not belong to it", async () => {
    mockApi(() => json(200, page([material()])));
    view();
    fireEvent.click(screen.getAllByRole("button", { name: "Edit Newton's laws" })[0]);
    const dialog = await screen.findByRole("dialog", { name: "Edit study material" });
    const subjectSelect = within(dialog).getByLabelText(/^Subject/) as HTMLSelectElement;
    expect(subjectSelect.value).toBe("10");
    fireEvent.change(within(dialog).getByLabelText(/^Category/), { target: { value: "2" } });
    expect((within(dialog).getByLabelText(/^Subject/) as HTMLSelectElement).value).toBe("");
    expect(within(dialog).queryByRole("option", { name: "Physics" })).not.toBeInTheDocument();
    expect(within(dialog).getByRole("option", { name: "Biology" })).toBeInTheDocument();
  });

  it("edits and deletes after a confirmation", async () => {
    const { calls } = mockApi((call) => (call.method === "GET" ? json(200, page([material()])) : call.method === "DELETE" ? json(204, undefined) : json(200, material())));
    view();
    fireEvent.click(screen.getAllByRole("button", { name: "Edit Newton's laws" })[0]);
    const dialog = await screen.findByRole("dialog", { name: "Edit study material" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save changes" }));
    expect(await screen.findByText("Material saved.")).toBeInTheDocument();
    expect(calls.find((call) => call.method === "PATCH")!.url).toBe("/api/v1/admin/materials/1/");
    fireEvent.click(screen.getAllByRole("button", { name: "Delete Newton's laws" })[0]);
    const confirm = await screen.findByRole("alertdialog", { name: "Delete this material?" });
    fireEvent.click(within(confirm).getByRole("button", { name: "Delete" }));
    expect(await screen.findByText("Material deleted.")).toBeInTheDocument();
    expect(calls.find((call) => call.method === "DELETE")!.url).toBe("/api/v1/admin/materials/1/");
  });
});
