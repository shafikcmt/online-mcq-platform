import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { SampleBlock } from "@/components/sample-block";
import { translator } from "@/lib/i18n";
import type { SampleList } from "@/lib/sample";

const data = (over: Partial<SampleList> = {}): SampleList => ({
  count: 2,
  total_marks: "30.00",
  results: [
    { name: "Zafar", marks: "25.00", percentage: "83.33", is_sample: true },
    { name: "Mina", marks: "10.00", percentage: "33.33", is_sample: true },
  ],
  ...over,
});

describe("SampleBlock", () => {
  const html = (d: SampleList, lang: "en" | "bn" = "en") => renderToStaticMarkup(<SampleBlock data={d} lang={lang} t={translator(lang)} />);

  it("labels the block and every row as sample, says they are not real, and has no rank", () => {
    const out = html(data());
    expect(out).toContain("Sample participants");
    expect(out).toContain("These are sample entries, not real students");
    expect(out.match(/>Sample</g)).toHaveLength(2); // a "Sample" label on each row
    expect(out).not.toContain("Position");
    expect(out).toContain("2 sample participants");
    expect(out).toContain("25 / 30");
  });

  it("may say in words where the marks would stand, and nothing when that is unknown", () => {
    const rows = data().results;
    const out = html(data({ results: [{ ...rows[0], position_by_marks: 2 }, { ...rows[1], position_by_marks: null }] }));
    expect(out.match(/By marks, this would be position/g)).toHaveLength(1);
    expect(out).toContain("By marks, this would be position 2 in the merit list");
    expect(html(data({ results: [{ ...rows[0], position_by_marks: 2 }] }), "bn")).toContain("অবস্থান হতো ২");
  });

  it("shows nothing when there are none", () => {
    expect(html(data({ count: 0, results: [] }))).toBe("");
  });

  it("is available in Bangla", () => {
    const out = html(data(), "bn");
    expect(out).toContain("স্যাম্পল অংশগ্রহণকারী");
    expect(out).toContain("প্রকৃত শিক্ষার্থী নয়");
  });
});
