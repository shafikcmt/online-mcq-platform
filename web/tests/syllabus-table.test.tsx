import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { SyllabusTable } from "@/components/syllabus-table";

const labels = { subject: "Subject", chapter: "Chapter", topic: "Topic" };

const render = (lines: { subject: string; chapter: string; topic: string }[], lang: "en" | "bn" = "en") =>
  renderToStaticMarkup(<SyllabusTable lines={lines} labels={labels} lang={lang} />);

describe("SyllabusTable", () => {
  it("lists the lines in order with their numbers and a heading row", () => {
    const html = render([
      { subject: "Physics", chapter: "Motion", topic: "Speed" },
      { subject: "", chapter: "Light", topic: "Reflection" },
    ]);
    expect(html.indexOf("Motion")).toBeLessThan(html.indexOf("Light"));
    expect(html).toContain("Subject");
    expect(html.match(/<li/g)).toHaveLength(2);
  });

  it("a missing part shows a dash, not an empty cell", () => {
    expect(render([{ subject: "", chapter: "", topic: "Only topic" }])).toContain("—");
  });

  it("numbers lines in Bangla digits for Bangla", () => {
    expect(render([{ subject: "পদার্থ", chapter: "", topic: "" }], "bn")).toContain("১");
  });

  it("renders the admin's text escaped, never as markup", () => {
    const html = render([{ subject: "<img src=x onerror=alert(1)>", chapter: "", topic: "" }]);
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img");
  });
});
