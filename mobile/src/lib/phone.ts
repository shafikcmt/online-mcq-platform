import { toWesternDigits } from "./text";

/** Client-side mirror of the backend's `normalize_bd_mobile` (apps/core/phone.py), used only
 * to give instant feedback and to send one canonical form. The server validates again. */
const NATIONAL = /^01[3-9]\d{8}$/;

export function normalizeBdMobile(input: string): string | null {
  let digits = toWesternDigits(input.trim()).replace(/[\s\-.()]/g, "");
  if (digits.startsWith("+")) digits = digits.slice(1);
  else if (digits.startsWith("00")) digits = digits.slice(2);
  const national = digits.startsWith("880") ? `0${digits.slice(3)}` : digits;
  return NATIONAL.test(national) ? `+880${national.slice(1)}` : null;
}

/** `+8801712345678` → `01712 345678` for display (the student's own number only). The
 * gap is a no-break space, so the number never wraps onto two lines. */
export function formatBdMobile(e164: string): string {
  const national = e164.startsWith("+880") ? `0${e164.slice(4)}` : e164;
  return national.length === 11 ? `${national.slice(0, 5)}\u00A0${national.slice(5)}` : national;
}
