import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { PackageCard } from "@/components/cards";
import type { Package } from "@/lib/api";
import { groupPackages } from "@/lib/packages";

const pkg = (slug: string, access: Package["access"], over: Partial<Package> = {}): Package => ({
  slug,
  name: slug.toUpperCase(),
  description: "",
  features: [],
  price: "500.00",
  currency: "BDT",
  validity_days: 30,
  is_featured: false,
  access,
  ...over,
});
const med = { slug: "medical", name: "Medical", exam_count: 5 };
const eng = { slug: "engineering", name: "Engineering", exam_count: 3 };
const only = (category: typeof med) => ({ scope: "selected" as const, exam_count: category.exam_count, categories: [category] });

describe("groupPackages", () => {
  it("groups single-category packages under their category and the rest under a mixed group, last", () => {
    const groups = groupPackages([
      pkg("all", { scope: "all", exam_count: 8, categories: [med, eng] }),
      pkg("med-1", only(med)),
      pkg("eng-1", only(eng)),
      pkg("med-2", only(med)),
      pkg("both", { scope: "selected", exam_count: 8, categories: [med, eng] }),
      pkg("none", { scope: "selected", exam_count: 0, categories: [] }),
    ]);
    expect(groups.map((g) => g.category?.slug ?? "mixed")).toEqual(["medical", "engineering", "mixed"]);
    expect(groups[0].packages.map((p) => p.slug)).toEqual(["med-1", "med-2"]);
    expect(groups[2].packages.map((p) => p.slug)).toEqual(["all", "both", "none"]);
  });

  it("a single group (or no packages) is returned as is", () => {
    expect(groupPackages([])).toEqual([]);
    const groups = groupPackages([pkg("a", only(med)), pkg("b", only(med))]);
    expect(groups).toHaveLength(1);
    expect(groups[0].category?.name).toBe("Medical");
  });
});

describe("PackageCard coverage line", () => {
  const html = (p: Package, lang: "en" | "bn" = "en") => renderToStaticMarkup(<PackageCard pkg={p} lang={lang} />);

  it("says which categories and how many exams", () => {
    expect(html(pkg("x", { scope: "selected", exam_count: 8, categories: [med, eng] }))).toContain("8 exams · Medical, Engineering");
    expect(html(pkg("x", only({ ...med, exam_count: 1 })))).toContain("1 exam · Medical");
  });

  it("says all paid exams for an all-exams package, in Bangla digits too", () => {
    expect(html(pkg("x", { scope: "all", exam_count: 8, categories: [] }))).toContain("All paid exams (8 open now)");
    expect(html(pkg("x", { scope: "all", exam_count: 8, categories: [] }), "bn")).toContain("সব পেইড পরীক্ষা (এখন খোলা ৮টি)");
  });

  it("shows nothing when the package covers nothing yet", () => {
    expect(html(pkg("x", { scope: "selected", exam_count: 0, categories: [] }))).not.toContain("exams ·");
  });
});
