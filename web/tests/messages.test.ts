import { describe, expect, test } from "vitest";

import bn from "../messages/bn.json";
import en from "../messages/en.json";

type Tree = Record<string, unknown>;

function flatten(node: unknown, prefix = ""): Record<string, string> {
  if (typeof node === "string") return { [prefix]: node };
  if (Array.isArray(node)) return Object.assign({}, ...node.map((item, index) => flatten(item, `${prefix}[${index}]`)));
  return Object.assign({}, ...Object.entries(node as Tree).map(([key, value]) => flatten(value, prefix ? `${prefix}.${key}` : key)));
}

const placeholders = (text: string) => [...text.matchAll(/\{\{(\w+)\}\}/g)].map((match) => match[1]).sort();

describe("website messages", () => {
  const flatBn = flatten(bn);
  const flatEn = flatten(en);

  test("both languages have exactly the same keys and placeholders, none empty", () => {
    expect(Object.keys(flatBn).sort()).toEqual(Object.keys(flatEn).sort());
    for (const key of Object.keys(flatEn)) {
      expect(flatEn[key].trim(), key).not.toBe("");
      expect(flatBn[key].trim(), key).not.toBe("");
      expect(placeholders(flatBn[key]), key).toEqual(placeholders(flatEn[key]));
    }
  });

  test("Bangla is really Bangla (only language names and pure formats may match)", () => {
    const same = new Set(["lang.bn", "lang.en", "package.per"]); // "/ {{days}}" reads the same in both
    for (const key of Object.keys(flatEn)) {
      if (!same.has(key)) expect(`${key}: ${flatBn[key]}`).not.toBe(`${key}: ${flatEn[key]}`);
    }
  });
});
