import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { NoticePdfLink } from "@/components/notice-pdf-link";
import type { Notice } from "@/lib/api";

const notice = (pdf: Notice["pdf"]): Notice => ({ id: 7, pdf, title: "T", body: "B", is_pinned: false, published_at: "2026-11-01T00:00:00Z", expires_at: null });

describe("NoticePdfLink", () => {
  it("renders nothing when the notice has no PDF", () => {
    expect(renderToStaticMarkup(<NoticePdfLink notice={notice({ available: false, name: "", size_bytes: 0 })} label="Open PDF" />)).toBe("");
  });

  it("links to the API address (not a media path) with the size", () => {
    const html = renderToStaticMarkup(<NoticePdfLink notice={notice({ available: true, name: "n.pdf", size_bytes: 2048 })} label="Open PDF" />);
    expect(html).toContain('href="/api/v1/public/announcements/7/pdf/"');
    expect(html).toContain("Open PDF");
    expect(html).toContain("2 KB");
    expect(html).toContain('rel="noopener"');
  });
});
