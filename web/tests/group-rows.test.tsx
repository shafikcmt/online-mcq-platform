import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ExamCards } from "@/components/exam-card";
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

describe("ExamCards", () => {
  const html = (rows: { exam: Exam; when: "open" | "upcoming" | "ended" }[], lang: "en" | "bn" = "en") =>
    renderToStaticMarkup(<ExamCards rows={rows} lang={lang} t={translator(lang)} />);
  const running = exam({ slug: "a", title: "Live one", start_at: "2026-11-20T10:00:00Z", end_at: "2026-11-20T20:00:00Z", subject: { slug: "ict", name: "ICT" } });

  it("marks a running scheduled exam Live with its day, subject and a start button; any-time and past exams are not live", () => {
    const out = html([
      { exam: running, when: "open" },
      { exam: exam({ slug: "b" }), when: "open" },
      { exam: exam({ slug: "c" }), when: "ended" },
    ]);
    expect(out.match(/>Live</g)).toHaveLength(1);
    expect(out).toContain("Friday, 20 November 2026");
    expect(out).toContain("Subject: ICT");
    expect(out).toContain("Start live exam");
    expect(out).toContain("A live exam is running now.");
    expect(out).toContain("Any time");
    expect(out).toContain("Archived");
    expect(out).toContain("View details");
  });

  it("shows two syllabus lines, the rest behind Show more, and the study-material count as a link", () => {
    const out = html([
      {
        exam: exam({
          slug: "s",
          syllabus: [
            { subject: "ICT", chapter: "Networks", topic: "" },
            { subject: "Math", chapter: "Algebra", topic: "Equations" },
            { subject: "English", chapter: "Grammar", topic: "Tense" },
          ],
          material_count: 2,
        }),
        when: "open",
      },
    ]);
    expect(out).toContain("1. ICT: Networks");
    expect(out).toContain("3. English: Grammar, Tense"); // inside the collapsed <details>
    expect(out).toContain("Show more");
    expect(out).toContain("Study materials (2)");
  });

  it("an upcoming exam has a disabled button saying when it starts, and is in Bangla on request", () => {
    const out = html([{ exam: exam({ start_at: "2026-12-01T10:00:00Z", end_at: "2026-12-01T12:00:00Z" }), when: "upcoming" }], "bn");
    expect(out).toContain('aria-disabled="true"');
    expect(out).toContain("শুরু");
    expect(out).toContain("আসছে");
  });
});

describe("apiPath with a shelf", () => {
  it("asks for one group's exams or only the ungrouped ones", () => {
    expect(apiPath({ when: "open", page: 1 }, { group: "bcs-prep" })).toBe("exams/?when=open&group=bcs-prep&page_size=12");
    expect(apiPath({ when: "open", category: "bcs", page: 1 }, { ungrouped: true })).toBe("exams/?when=open&category=bcs&ungrouped=true&page_size=12");
  });
});
