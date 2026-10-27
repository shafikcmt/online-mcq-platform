import type { TFunction } from "i18next";

import { localizeDigits } from "@/lib/text";

/** "12 min 30 s" (time used in an exam). */
export function formatDuration(totalSeconds: number, t: TFunction, language: string): string {
  const seconds = Math.max(0, Math.round(totalSeconds));
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  const n = (value: number) => localizeDigits(value, language);
  return m > 0 ? t("results:duration.minutesSeconds", { m: n(m), s: n(s) }) : t("results:duration.seconds", { s: n(s) });
}
