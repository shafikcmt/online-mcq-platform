import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ExamSection, StudySection } from "@/components/home-sections";
import type { Category } from "@/lib/api";
import { translator } from "@/lib/i18n";

const category = (over: Partial<Category>): Category => ({ slug: "bcs", name: "BCS", description: "", exam_count: 4, live_count: 0, subjects: [], ...over });

describe("ExamSection", () => {
  const html = (categories: Category[], lang: "en" | "bn" = "en") => renderToStaticMarkup(<ExamSection categories={categories} lang={lang} t={translator(lang)} />);

  it("links each category to its own page and counts its exams", () => {
    const out = html([category({}), category({ slug: "bank", name: "Bank jobs", exam_count: 1 })]);
    expect(out).toContain("Exam section");
    expect(out).toContain('href="/en/category/bcs"');
    expect(out).toContain("4 exams");
    expect(out).toContain("1 exam<");
  });

  it("marks only a category with an exam running now, in words too", () => {
    const out = html([category({ live_count: 2 }), category({ slug: "bank", name: "Bank jobs" })]);
    expect(out.match(/live now/g)).toHaveLength(1);
    expect(html([category({ live_count: undefined })])).not.toContain("live now"); // an older server
  });

  it("is in Bangla", () => {
    const out = html([category({ live_count: 1 })], "bn");
    expect(out).toContain("পরীক্ষা বিভাগ");
    expect(out).toContain("এখন লাইভ");
  });
});

describe("StudySection", () => {
  const html = (counts: { video: number; pdf: number }) => renderToStaticMarkup(<StudySection counts={counts} lang="en" t={translator("en")} />);

  it("a part with nothing published says Coming soon and is not a link", () => {
    const out = html({ video: 3, pdf: 0 });
    expect(out).toContain('href="/en/materials?kind=video"');
    expect(out).not.toContain("kind=pdf");
    expect(out.match(/Coming soon/g)).toHaveLength(1);
  });

  it("both parts open once both have content", () => {
    const out = html({ video: 1, pdf: 1 });
    expect(out).toContain("kind=pdf");
    expect(out).not.toContain("Coming soon");
  });
});
