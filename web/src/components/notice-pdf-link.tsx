import { FileText } from "lucide-react";

import type { Notice } from "@/lib/api";

/** "Open PDF" for a notice that has one. The file is served by the API on this same address
 * (never from a media path), so it opens in the visitor's own PDF viewer. */
export function NoticePdfLink({ notice, label }: { notice: Notice; label: string }) {
  if (!notice.pdf?.available) return null;
  const kb = Math.max(1, Math.round(notice.pdf.size_bytes / 1024));
  const size = kb >= 1024 ? `${(kb / 1024).toFixed(1)} MB` : `${kb} KB`;
  return (
    <a
      href={`/api/v1/public/announcements/${notice.id}/pdf/`}
      target="_blank"
      rel="noopener"
      className="mt-3 inline-flex min-h-11 items-center gap-2 rounded-control border border-line-strong px-4 text-sm font-semibold text-brand-700 hover:bg-brand-50"
    >
      <FileText className="size-4" aria-hidden />
      {label}
      <span className="font-normal text-ink-subtle">({size})</span>
    </a>
  );
}
