import { formatBdMobile, normalizeBdMobile } from "@/lib/phone";
import { hasBengali, localizeDigits, toBanglaDigits, toWesternDigits } from "@/lib/text";

describe("normalizeBdMobile mirrors the server's accepted forms", () => {
  test.each([
    ["01712345678", "+8801712345678"],
    ["8801712345678", "+8801712345678"],
    ["+8801712345678", "+8801712345678"],
    ["008801712345678", "+8801712345678"],
    ["017-1234 5678", "+8801712345678"],
    ["(017) 1234.5678", "+8801712345678"],
    ["০১৭১২৩৪৫৬৭৮", "+8801712345678"],
    [" 01312345678 ", "+8801312345678"],
  ])("%s → %s", (input, expected) => {
    expect(normalizeBdMobile(input)).toBe(expected);
  });

  test.each(["", "0171234567", "017123456789", "01212345678", "02712345678", "+447712345678", "abc"])("rejects %p", (input) => {
    expect(normalizeBdMobile(input)).toBeNull();
  });
});

test("digits and scripts", () => {
  expect(toWesternDigits("০১২৩৪৫৬৭৮৯")).toBe("0123456789");
  expect(toBanglaDigits("2026-10")).toBe("২০২৬-১০");
  expect(localizeDigits(42, "bn")).toBe("৪২");
  expect(localizeDigits(42, "en")).toBe("42");
  expect(hasBengali("Physics পদার্থ")).toBe(true);
  expect(hasBengali("Physics")).toBe(false);
  expect(formatBdMobile("+8801712345678")).toBe("01712\u00A0345678");
});
