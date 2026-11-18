import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { LegalBody } from "@/components/legal-page";
import type { CmsPage } from "@/lib/api";
import { messages } from "@/lib/i18n";

describe("LegalBody", () => {
  const { legal } = messages("en");

  it("shows the introduction and every section with its heading, in both languages", () => {
    for (const lang of ["en", "bn"] as const) {
      const text = messages(lang).legal;
      const out = renderToStaticMarkup(<LegalBody legal={text.privacy} updated={text.updated} page={null} lang={lang} />);
      expect(out).toContain(text.privacy.intro);
      for (const section of text.privacy.sections) expect(out).toContain(section.title);
      expect(out).toContain(text.updated);
    }
  });

  it("an admin-written page replaces our text, shown as plain text and never as markup", () => {
    const page: CmsPage = { slug: "privacy", title: "Our policy", body: "Line one\n<img src=x onerror=alert(1)>", updated_at: "2026-11-18T00:00:00Z" };
    const out = renderToStaticMarkup(<LegalBody legal={legal.privacy} updated={legal.updated} page={page} lang="en" />);
    expect(out).toContain("Line one");
    expect(out).not.toContain("<img");
    expect(out).not.toContain(legal.privacy.intro);
  });

  it("the policy says what is kept after an account is deleted, and the delete page agrees", () => {
    expect(legal.privacy.sections.map((s) => s.body).join(" ")).toContain("kept without your name");
    expect(legal.deleteAccount.kept).toContain("without your name");
    expect(legal.deleteAccount.appSteps).toContain("Delete account");
    expect(legal.terms.sections.length).toBeGreaterThanOrEqual(8);
  });
});
