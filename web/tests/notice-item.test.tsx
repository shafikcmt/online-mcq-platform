import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { NoticeItem } from "@/components/cards";
import type { Notice } from "@/lib/api";

const notice = (over: Partial<Notice> = {}): Notice => ({
  id: 3,
  title: "Room change",
  body: "Hall B.",
  is_pinned: false,
  published_at: "2026-11-14T06:00:00Z",
  expires_at: null,
  pdf: { available: false, name: "", size_bytes: 0 },
  exam: null,
  ...over,
});

describe("NoticeItem", () => {
  it("names and links the exam a notice is about", () => {
    const html = renderToStaticMarkup(<NoticeItem notice={notice({ exam: { slug: "physics-1", title: "Physics final" } })} lang="en" />);
    expect(html).toContain('href="/en/exams/physics-1"');
    expect(html).toContain("About: Physics final");
  });

  it("a general notice, and a notice on its own exam's page, show no exam link", () => {
    expect(renderToStaticMarkup(<NoticeItem notice={notice()} lang="en" />)).not.toContain("About:");
    expect(renderToStaticMarkup(<NoticeItem notice={notice({ exam: undefined })} lang="en" />)).not.toContain("About:"); // an older server
    const onExamPage = renderToStaticMarkup(<NoticeItem notice={notice({ exam: { slug: "physics-1", title: "Physics final" } })} lang="en" showExam={false} />);
    expect(onExamPage).not.toContain("About:");
  });

  it("writes the exam title escaped, never as markup", () => {
    const html = renderToStaticMarkup(<NoticeItem notice={notice({ exam: { slug: "x", title: "<img src=x onerror=alert(1)>" } })} lang="bn" />);
    expect(html).not.toContain("<img");
    expect(html).toContain("পরীক্ষা:");
  });
});
