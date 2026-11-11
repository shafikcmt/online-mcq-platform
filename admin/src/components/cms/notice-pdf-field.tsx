"use client";

import { PdfAttachment } from "@/components/ui/pdf-attachment";
import { useI18n } from "@/lib/i18n/provider";
import type { Announcement } from "@/types/cms";

const MAX_MB = "10";

/** The optional PDF of an announcement (see `PdfAttachment`). A new announcement must be saved first. */
export function NoticePdfField({ notice, onChanged }: { notice: Announcement | null; onChanged: () => void }) {
  const { t } = useI18n();
  return (
    <PdfAttachment
      endpoint={notice ? `/admin/announcements/${notice.id}/pdf/` : null}
      openHref={notice ? `/api/v1/public/announcements/${notice.id}/pdf/` : ""}
      initial={notice?.pdf}
      title={t("np.title")}
      hint={t("np.hint", { mb: MAX_MB })}
      saveFirst={t("np.saveFirst")}
      removeBody={t("np.removeBody")}
      onChanged={onChanged}
    />
  );
}
