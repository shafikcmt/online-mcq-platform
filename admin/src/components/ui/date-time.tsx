"use client";

import { formatDateTime } from "@/lib/format";
import { useI18n } from "@/lib/i18n/provider";

/** A date-time for table cells: may break only between the date and the time ("28 Oct
 * 2026," / "14:16"), never inside either, so narrow columns show two tidy lines. */
export function DateTimeText({ iso }: { iso: string }) {
  const { locale } = useI18n();
  const text = formatDateTime(iso, locale);
  const cut = text.lastIndexOf(", ");
  if (cut < 0) return <span className="whitespace-nowrap">{text}</span>;
  return (
    <>
      <span className="whitespace-nowrap">{text.slice(0, cut + 1)}</span>{" "}
      <span className="whitespace-nowrap">{text.slice(cut + 2)}</span>
    </>
  );
}
