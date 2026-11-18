const BENGALI = /[ঀ-৿]/;

/** True when the text contains Bangla script (so it needs the Bangla font). */
export function hasBengali(text: string): boolean {
  return BENGALI.test(text);
}

const BANGLA_DIGITS = "০১২৩৪৫৬৭৮৯";

/** Bangla digits (০-৯) → Western digits; everything else unchanged. */
export function toWesternDigits(value: string): string {
  return value.replace(/[০-৯]/g, (digit) => String(BANGLA_DIGITS.indexOf(digit)));
}

/** Western digits → Bangla digits, for numbers shown in the Bangla UI. */
export function toBanglaDigits(value: string | number): string {
  return String(value).replace(/[0-9]/g, (digit) => BANGLA_DIGITS[Number(digit)]);
}

/** Digits in the UI language. */
export function localizeDigits(value: string | number, language: string): string {
  return language === "bn" ? toBanglaDigits(value) : String(value);
}

/** An admin-typed name with the usual stray spaces removed: runs of spaces become one, and no space
 * is left just inside brackets ("University ( A Unit)" → "University (A Unit)"). Display only. */
export function tidyName(value: string): string {
  return value.replace(/\s+/g, " ").replace(/\(\s+/g, "(").replace(/\s+\)/g, ")").trim();
}
