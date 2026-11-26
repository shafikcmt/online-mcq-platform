import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ExamRows } from "@/components/exam-rows";
import { GroupRows } from "@/components/group-rows";
import type { Exam, Group } from "@/lib/api";
import { apiPath } from "@/lib/exam-filters";
import { translator } from "@/lib/i18n";

const group = (over: Partial<Group> = {}): Group => ({ slug: "bcs-prep", name: "52nd BCS preparation", description: "", exam_count: 3, live_count: 0, child_count: 0, ...over });
const exam = (over: Partial<Exam> = {}): Exam => ({
  slug: "quiz-1", title: "Daily quiz", description: "", instructions: "", exam_type: "regular", access_type: "free", content_language: "both",
  category: { slug: "bcs", name: "BCS" }, subject: null, duration_minutes: 20, total_questions: 10, total_marks: "10.00", negative_marks: "0.00",
  pass_marks: null, start_at: null, end_at: null, is_featured: false, ...over,
});

describe("GroupRows", () => {
  const html = (groups: Group[], lang: "en" | "bn" = "en") => renderToStaticMarkup(<GroupRows groups={groups} lang={lang} t={translator(lang)} />);

  it("links each group to its own page with its exam and sub-group counts", () => {
    const out = html([group({ child_count: 2 }), group({ slug: "daily", name: "Daily quiz", exam_count: 1 })]);
    expect(out).toContain('href="/en/group/bcs-prep"');
    expect(out).toContain("3 exams · 2 sub-groups");
    expect(out).toContain("1 exam<");
  });

  it("marks only a group with an exam running now, with the word Live (never colour alone)", () => {
    expect(html([group({ live_count: 1 }), group({ slug: "b" })]).match(/>Live</g)).toHaveLength(1);
  });

  it("is in Bangla", () => {
    expect(html([group({ live_count: 1 })], "bn")).toContain("৩টি পরীক্ষা");
  });
});

describe("ExamRows", () => {
  const html = (rows: { exam: Exam; when: "open" | "upcoming" | "ended" }[]) => renderToStaticMarkup(<ExamRows rows={rows} lang="en" t={translator("en")} />);

  it("marks a running scheduled exam Live, an any-time exam not, and past ones Archived", () => {
    const out = html([
      { exam: exam({ slug: "a", start_at: "2026-11-20T10:00:00Z", end_at: "2026-11-20T20:00:00Z" }), when: "open" },
      { exam: exam({ slug: "b" }), when: "open" },
      { exam: exam({ slug: "c" }), when: "ended" },
    ]);
    expect(out.match(/>Live</g)).toHaveLength(1);
    expect(out).toContain("Archived");
  });
});

describe("apiPath with a shelf", () => {
  it("asks for one group's exams or only the ungrouped ones", () => {
    expect(apiPath({ when: "open", page: 1 }, { group: "bcs-prep" })).toBe("exams/?when=open&group=bcs-prep&page_size=12");
    expect(apiPath({ when: "open", category: "bcs", page: 1 }, { ungrouped: true })).toBe("exams/?when=open&category=bcs&ungrouped=true&page_size=12");
  });
});
