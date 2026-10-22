import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const router = { push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() };
vi.mock("next/navigation", () => ({
  useRouter: () => router,
  usePathname: () => "/packages",
  useSearchParams: () => new URLSearchParams(window.location.search),
}));

import { PackageEditor } from "@/components/packages/package-editor";
import { PackagesView } from "@/components/packages/packages-view";
import { PACKAGE_LIST } from "@/lib/content-specs";
import { parseListParams } from "@/lib/list-params";
import { toPackagePayload, newPackageDraft } from "@/lib/package-form";
import type { AccessRule, Package } from "@/types/packages";

import { apiError, category, exam, findToast, json, mockApi, page, renderPanel } from "./content-helpers";

function pkg(overrides: Partial<Package> = {}): Package {
  return {
    id: 5,
    name_bn: "গোল্ড",
    name_en: "Gold",
    slug: "gold",
    description_bn: "",
    description_en: "All exams for a month.",
    features_bn: [],
    features_en: ["Unlimited exams", "Merit lists"],
    price: "500.00",
    currency: "BDT",
    validity_days: 30,
    status: "active",
    sort_order: 1,
    is_featured: true,
    rule_count: 2,
    subscription_count: 0,
    created_at: "2026-10-01T08:00:00Z",
    updated_at: "2026-10-02T08:00:00Z",
    ...overrides,
  };
}

const physics = category({ id: 3, name_en: "Physics", name_bn: "পদার্থবিজ্ঞান", slug: "physics" });
const chemistry = category({ id: 4, name_en: "Chemistry", name_bn: "রসায়ন", slug: "chemistry" });
const lookups = { categories: [physics, chemistry], lookupTruncated: false };
const rules: AccessRule[] = [
  { rule_type: "category", category: { id: 3, slug: "physics", name_bn: "পদার্থবিজ্ঞান", name_en: "Physics" }, exam: null },
  {
    rule_type: "exam",
    category: null,
    exam: { id: 12, slug: "final", title_bn: "ফাইনাল", title_en: "Biology final", access_type: "paid", status: "published" },
  },
];

const state = (query = "") => {
  window.history.replaceState({}, "", `/packages${query ? `?${query}` : ""}`);
  return parseListParams(new URLSearchParams(query), PACKAGE_LIST);
};
const list = (query = "", data = page([pkg(), pkg({ id: 6, name_en: "Silver", name_bn: "", slug: "silver", status: "inactive", is_featured: false, rule_count: 0, subscription_count: 3, price: "250.00" })]), locale: "en" | "bn" = "en") =>
  renderPanel(<PackagesView data={data} state={state(query)} />, locale);
const editor = (overrides: Partial<Package> = {}, ruleList = rules) =>
  renderPanel(<PackageEditor pkg={pkg(overrides)} rules={ruleList} {...lookups} />);
const table = () => screen.getByRole("table");
const bodyRows = () => within(table()).getAllByRole("row").slice(1);
const lastQuery = () => new URL(String(router.push.mock.lastCall?.[0]), "http://x").searchParams;
const priceInput = () => document.getElementById("package-price") as HTMLInputElement;
const rulesRegion = () => screen.getByRole("region", { name: "Access rules" });

beforeEach(() => {
  router.push.mockReset();
  router.replace.mockReset();
  window.history.replaceState({}, "", "/packages/5");
});

describe("PackagesView", () => {
  it("shows name, slug, price, validity, status, featured, rule and subscription counts", () => {
    list();
    const [gold, silver] = bodyRows();
    expect(gold).toHaveTextContent("Gold");
    expect(gold).toHaveTextContent("গোল্ড");
    expect(gold).toHaveTextContent("gold");
    expect(gold).toHaveTextContent("৳ 500.00");
    expect(gold).toHaveTextContent("30 days");
    expect(gold).toHaveTextContent("Active");
    expect(gold).toHaveTextContent("Featured");
    expect(gold).toHaveTextContent("Rules: 2");
    expect(silver).toHaveTextContent("Inactive");
    expect(silver).toHaveTextContent("No rules");
    expect(silver).toHaveTextContent("3");
    expect(within(gold).getAllByRole("link", { name: "Open Gold" })[0]).toHaveAttribute("href", "/packages/5");
    expect(screen.getByRole("link", { name: "New package" })).toHaveAttribute("href", "/packages/new");
  });

  it("search, filters and sorting go to the URL (server-side)", () => {
    list();
    fireEvent.change(screen.getAllByLabelText("Status")[0], { target: { value: "inactive" } });
    expect(lastQuery().get("status")).toBe("inactive");
    fireEvent.change(screen.getAllByLabelText("Featured")[0], { target: { value: "true" } });
    expect(lastQuery().get("is_featured")).toBe("true");
    fireEvent.click(within(table()).getByRole("button", { name: /Price/ }));
    expect(lastQuery().get("ordering")).toBe("price");
    fireEvent.change(screen.getAllByLabelText("Sort")[0], { target: { value: "-validity_days" } });
    expect(lastQuery().get("ordering")).toBe("-validity_days");
  });

  it("empty, no-match and Bangla", () => {
    const { unmount } = list("", page([]));
    expect(screen.getByText("No packages yet")).toBeInTheDocument();
    unmount();
    const second = list("status=inactive", page([]));
    expect(screen.getByText("No packages match these filters")).toBeInTheDocument();
    second.unmount();
    list("", page([pkg()]), "bn");
    expect(screen.getByRole("heading", { level: 1, name: "প্যাকেজ" })).toBeInTheDocument();
    expect(bodyRows()[0]).toHaveTextContent("30 দিন");
    expect(bodyRows()[0]).toHaveTextContent("সক্রিয়");
  });
});

describe("PackageEditor — create and edit", () => {
  it("create: POSTs the bilingual fields, features as lines, numbers, status; opens the new package", async () => {
    const { calls } = mockApi(() => json(201, pkg({ id: 42 })));
    renderPanel(<PackageEditor pkg={null} rules={[]} {...lookups} />);
    expect(screen.getByRole("heading", { level: 1, name: "New package" })).toBeInTheDocument();
    expect(screen.getByText("Create the package first, then choose its access rules.")).toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "Package actions" })).not.toBeInTheDocument();
    fireEvent.change(document.getElementById("package-name_en")!, { target: { value: "Gold" } });
    fireEvent.change(document.getElementById("package-name_bn")!, { target: { value: "গোল্ড" } });
    fireEvent.change(document.getElementById("package-features_en")!, { target: { value: "Unlimited exams\nMerit lists" } });
    fireEvent.change(priceInput(), { target: { value: "500" } });
    fireEvent.change(screen.getByLabelText(/^Validity/), { target: { value: "30" } });
    fireEvent.click(screen.getByRole("button", { name: "Create package" }));
    await waitFor(() => expect(router.push).toHaveBeenCalledWith("/packages/42"));
    expect(calls[0]).toMatchObject({ method: "POST", url: "/api/v1/admin/packages/" });
    expect(calls[0].body).toMatchObject({
      name_en: "Gold",
      name_bn: "গোল্ড",
      features_en: ["Unlimited exams", "Merit lists"],
      price: "500",
      currency: "BDT",
      validity_days: 30,
      status: "active",
      is_featured: false,
    });
    expect(calls[0].body).not.toHaveProperty("sort_order"); // empty: the server default
  });

  it("the validity and price notes are shown next to their fields", () => {
    editor();
    expect(screen.getByText("Validity changes apply to future grants and may also affect payments that have not yet been verified.")).toBeInTheDocument();
    expect(screen.getByLabelText(/^Validity/)).toHaveAccessibleDescription(/may also affect payments that have not yet been verified/);
  });

  it("server validation errors land on their fields (features list items too); nothing invented client-side", async () => {
    mockApi(() =>
      apiError(400, "validation_error", "Invalid input.", {
        name_bn: ["Enter a name in Bangla or English (at least one is required)."],
        name_en: ["Enter a name in Bangla or English (at least one is required)."],
        validity_days: ["Ensure this value is less than or equal to 3650."],
        features_en: { "1": ["Ensure this field has no more than 1000 characters."] },
      }),
    );
    editor();
    fireEvent.change(screen.getByLabelText(/^Validity/), { target: { value: "99999" } });
    fireEvent.click(screen.getByRole("button", { name: "Save package" }));
    expect(await screen.findByText("Please correct the highlighted fields.")).toBeInTheDocument();
    expect(screen.getByLabelText(/^Validity/)).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByText("Ensure this value is less than or equal to 3650.")).toBeInTheDocument();
    expect(screen.getByText("Ensure this field has no more than 1000 characters.")).toBeInTheDocument();
    expect(screen.getByText("Enter a name in Bangla or English (at least one is required).")).toBeInTheDocument();
  });

  it("edit: PATCH without status; the server's package replaces the form", async () => {
    const { calls } = mockApi(() => json(200, pkg({ price: "600.00", updated_at: "2026-10-03T08:00:00Z" })));
    editor();
    expect(screen.queryByLabelText(/^Status/)).not.toBeInTheDocument(); // status changes through the actions
    fireEvent.change(priceInput(), { target: { value: "600" } });
    expect(screen.getByText("Unsaved changes")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Save package" }));
    expect(await findToast()).toHaveTextContent("Package saved.");
    expect(calls[0]).toMatchObject({ method: "PATCH", url: "/api/v1/admin/packages/5/" });
    expect(calls[0].body).not.toHaveProperty("status");
    expect(priceInput()).toHaveValue("600.00");
    expect(screen.queryByText("Unsaved changes")).not.toBeInTheDocument();
  });

  it("payload helper: whole numbers as numbers, anything else as typed for the server to judge", () => {
    const payload = toPackagePayload({ ...newPackageDraft(), validity_days: "3x", sort_order: "7" }, { isNew: false });
    expect(payload.validity_days).toBe("3x");
    expect(payload.sort_order).toBe(7);
    expect(payload).not.toHaveProperty("status");
  });
});

describe("PackageEditor — status and delete", () => {
  it("deactivate: confirmation explains the consequences; PATCH status; the server's answer is shown", async () => {
    const { calls } = mockApi(() => json(200, pkg({ status: "inactive" })));
    editor();
    fireEvent.click(screen.getByRole("button", { name: "Deactivate" }));
    const dialog = screen.getByRole("alertdialog", { name: "Deactivate this package?" });
    expect(dialog).toHaveTextContent("New sales and manual grants stop.");
    expect(dialog).toHaveTextContent("Existing subscriptions keep their access until they expire.");
    expect(dialog).toHaveTextContent("may still be honoured when it is verified");
    expect(within(dialog).getByRole("button", { name: "Cancel" })).toHaveFocus();
    expect(calls).toHaveLength(0); // nothing before the confirmation
    fireEvent.click(within(dialog).getByRole("button", { name: "Deactivate" }));
    expect(await findToast()).toHaveTextContent("Package deactivated.");
    expect(calls[0]).toMatchObject({ method: "PATCH", url: "/api/v1/admin/packages/5/", body: { status: "inactive" } });
    expect(screen.getByRole("button", { name: "Activate" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1 }).parentElement).toHaveTextContent("Inactive");
  });

  it("activate an inactive package", async () => {
    const { calls } = mockApi(() => json(200, pkg({ status: "active" })));
    editor({ status: "inactive" });
    fireEvent.click(screen.getByRole("button", { name: "Activate" }));
    fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Activate" }));
    expect(await findToast()).toHaveTextContent("Package activated.");
    expect(calls[0].body).toEqual({ status: "active" });
  });

  it("delete an unused package after confirmation, then back to the list", async () => {
    const { calls } = mockApi(() => json(204, undefined));
    editor();
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    const dialog = screen.getByRole("alertdialog", { name: "Delete this package?" });
    expect(dialog).toHaveTextContent("“Gold” and its access rules will be removed.");
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(router.push).toHaveBeenCalledWith("/packages"));
    expect(calls[0]).toMatchObject({ method: "DELETE", url: "/api/v1/admin/packages/5/" });
  });

  it("409 in_use from the server is shown in the dialog, never treated as success", async () => {
    mockApi(() => apiError(409, "in_use", "This package has subscriptions and cannot be deleted."));
    editor();
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    const dialog = screen.getByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete" }));
    expect(await within(dialog).findByText("This package is in use")).toBeInTheDocument();
    expect(within(dialog).getByText("This package has subscriptions and cannot be deleted.")).toBeInTheDocument();
    expect(router.push).not.toHaveBeenCalled();
  });

  it("a package with subscriptions offers no Delete, explains why and links to its subscriptions", () => {
    editor({ subscription_count: 3 });
    expect(screen.queryByRole("button", { name: "Delete" })).not.toBeInTheDocument();
    expect(screen.getByText(/cannot be deleted. Deactivate it to stop new sales./)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "View subscriptions" })).toHaveAttribute("href", "/subscriptions?package=5");
  });

  it("an existing package links to its payments (7H); a new one does not", () => {
    const { unmount } = editor();
    expect(screen.getByRole("link", { name: "View payments" })).toHaveAttribute("href", "/payments?package=5");
    unmount();
    renderPanel(<PackageEditor pkg={null} rules={[]} {...lookups} />);
    expect(screen.queryByRole("link", { name: "View payments" })).not.toBeInTheDocument();
  });

  it("actions wait while the settings are unsaved", () => {
    editor();
    fireEvent.change(priceInput(), { target: { value: "1" } });
    expect(screen.getByRole("button", { name: "Deactivate" })).toBeDisabled();
    expect(screen.getByText("Save or discard your changes first.")).toBeInTheDocument();
  });
});

describe("AccessRulesEditor", () => {
  it("shows the saved rules and the always-visible immediate-effect warning", () => {
    editor();
    const region = rulesRegion();
    expect(within(region).getByRole("note")).toHaveTextContent("Access-rule changes apply immediately to existing subscribers.");
    expect(within(region).getByRole("switch", { name: "All paid exams" })).not.toBeChecked();
    expect(within(region).getByRole("checkbox", { name: "Physics" })).toBeChecked();
    expect(within(region).getByRole("checkbox", { name: "Chemistry" })).not.toBeChecked();
    expect(within(region).getByText("Biology final")).toBeInTheDocument();
    expect(within(region).getByRole("button", { name: "Save access rules" })).toBeDisabled(); // nothing changed
  });

  it("PATCHes the COMPLETE list (all paid + categories + exams) and shows the server's list", async () => {
    const saved: AccessRule[] = [{ rule_type: "all_paid_exams", category: null, exam: null }, ...rules];
    const { calls } = mockApi(() => json(200, { rules: saved }));
    editor();
    const region = rulesRegion();
    fireEvent.click(within(region).getByRole("switch", { name: "All paid exams" }));
    fireEvent.click(within(region).getByRole("checkbox", { name: "Chemistry" }));
    fireEvent.click(within(region).getByRole("checkbox", { name: "Chemistry" })); // and back
    fireEvent.click(within(region).getByRole("button", { name: "Save access rules" }));
    expect(await findToast()).toHaveTextContent("Access rules saved.");
    expect(calls[0]).toMatchObject({ method: "PATCH", url: "/api/v1/admin/packages/5/access-rules/" });
    expect(calls[0].body).toEqual({
      rules: [{ rule_type: "all_paid_exams" }, { rule_type: "category", category: 3 }, { rule_type: "exam", exam: 12 }],
    });
    expect(screen.getByText(/Rules: 3/)).toBeInTheDocument(); // header facts follow the server
  });

  it("removing an exam, then a server rule error is listed (e.g. a free exam), nothing invented", async () => {
    mockApi(() => apiError(400, "validation_error", "Invalid input.", { rules: ["Exam #12 is free; only paid exams can be added to a package."] }));
    editor();
    const region = rulesRegion();
    fireEvent.click(within(region).getByRole("button", { name: "Remove Biology final" }));
    expect(within(region).getByText("No individual exams.")).toBeInTheDocument();
    fireEvent.click(within(region).getByRole("button", { name: "Save access rules" }));
    expect(await within(region).findByText("Exam #12 is free; only paid exams can be added to a package.")).toBeInTheDocument();
  });

  it("exam picker asks the server for PAID exams only, bounded; chosen exams are not offered twice", async () => {
    const { calls } = mockApi(() =>
      json(200, page([exam({ id: 12, title_en: "Biology final", access_type: "paid" }), exam({ id: 13, title_en: "Chemistry final", access_type: "paid" })])),
    );
    editor();
    fireEvent.click(within(rulesRegion()).getByRole("button", { name: "Add a paid exam" }));
    const dialog = await screen.findByRole("dialog", { name: "Add a paid exam" });
    await within(dialog).findByText("Chemistry final");
    for (const call of calls) {
      const query = new URL(call.url, "http://x").searchParams;
      expect(query.get("access_type")).toBe("paid");
      expect(query.get("page_size")).toBe("10");
    }
    expect(within(dialog).queryByRole("button", { name: "Add Biology final" })).not.toBeInTheDocument();
    expect(within(dialog).getByText("Added")).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Add Chemistry final" }));
    await act(async () => fireEvent.keyDown(dialog, { key: "Escape" }));
    expect(within(rulesRegion()).getByText("Chemistry final")).toBeInTheDocument();
    expect(within(rulesRegion()).getByRole("button", { name: "Save access rules" })).toBeEnabled();
  });

  it("Bangla", () => {
    renderPanel(<PackageEditor pkg={pkg()} rules={rules} {...lookups} />, "bn");
    expect(screen.getByRole("region", { name: "অ্যাক্সেস নিয়ম" })).toHaveTextContent(
      "অ্যাক্সেস নিয়মের পরিবর্তন সঙ্গে সঙ্গে বর্তমান গ্রাহকদের ওপর প্রযোজ্য হয়।",
    );
    expect(screen.getByRole("button", { name: "নিষ্ক্রিয় করুন" })).toBeInTheDocument();
  });
});
