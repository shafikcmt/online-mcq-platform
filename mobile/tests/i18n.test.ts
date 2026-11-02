import i18n, { resources } from "@/i18n";

type Tree = { [key: string]: string | Tree };

function flatten(tree: Tree, prefix = ""): Record<string, string> {
  return Object.entries(tree).reduce<Record<string, string>>((out, [key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    return typeof value === "string" ? { ...out, [path]: value } : { ...out, ...flatten(value, path) };
  }, {});
}

const placeholders = (text: string) => (text.match(/\{\{\s*\w+\s*\}\}/g) ?? []).sort();

describe("translations", () => {
  const namespaces = Object.keys(resources.en) as (keyof typeof resources.en)[];

  test.each(namespaces)("%s: every key exists in Bangla and English, none empty, same placeholders", (ns) => {
    const bn = flatten(resources.bn[ns] as Tree);
    const en = flatten(resources.en[ns] as Tree);
    expect(Object.keys(bn).sort()).toEqual(Object.keys(en).sort());
    for (const key of Object.keys(en)) {
      expect(en[key].trim()).not.toBe("");
      expect(bn[key].trim()).not.toBe("");
      expect(placeholders(bn[key])).toEqual(placeholders(en[key]));
    }
  });

  test("Bangla strings are really Bangla (not English left untranslated)", () => {
    // Language names, and pure number formats ("2.5/3", "83%") that read the same in both.
    const allowedSame = new Set(["language.bn", "language.en", "greeting", "spotlight.state.live", "result.marks", "result.percent", "done.marks", "done.percent", "detail.marks", "detail.percent"]);
    for (const ns of namespaces) {
      const bn = flatten(resources.bn[ns] as Tree);
      const en = flatten(resources.en[ns] as Tree);
      for (const key of Object.keys(en)) {
        if (!allowedSame.has(key)) expect(`${ns}:${key} ${bn[key]}`).not.toBe(`${ns}:${key} ${en[key]}`);
      }
    }
  });

  test("counted texts: English singular/plural by count, Bangla digits in Bangla", () => {
    const en = i18n.getFixedT("en");
    const bn = i18n.getFixedT("bn");
    expect(en("packages:validity", { count: 1, n: "1" })).toBe("1 day");
    expect(en("packages:validity", { count: 30, n: "30" })).toBe("30 days");
    expect(en("auth:otp.attemptsLeft", { count: 1, n: "1" })).toBe("1 attempt left.");
    expect(bn("auth:otp.attemptsLeft", { count: 3, n: "৩" })).toBe("আর ৩ বার চেষ্টা করা যাবে।");
    expect(bn("packages:validity", { count: 1, n: "১" })).toBe("১ দিন");
  });
});
