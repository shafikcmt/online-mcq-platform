"use client";

import { Pencil, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import { useI18n } from "@/lib/i18n/provider";
import { localized } from "@/lib/localized";

/** Bilingual name: the UI language's version first, the other one underneath. */
export function BilingualName({ bn, en }: { bn: string; en: string }) {
  const { locale } = useI18n();
  const primary = localized(locale, bn, en);
  const secondary = primary.lang === "bn" ? { text: en, lang: "en" } : { text: bn, lang: "bn" };
  return (
    <span className="block min-w-0">
      <span lang={primary.lang} className="block font-medium break-words text-ink">
        {primary.text}
      </span>
      {secondary.text && (
        <span lang={secondary.lang} className="block text-[13px] break-words text-ink-subtle">
          {secondary.text}
        </span>
      )}
    </span>
  );
}

export function ActiveBadge({ active }: { active: boolean }) {
  const { t } = useI18n();
  return <StatusBadge status={active ? "active" : "inactive"} label={t(active ? "status.active" : "status.inactive")} />;
}

export function RowActions({
  editLabel,
  deleteLabel,
  onEdit,
  onDelete,
}: {
  editLabel: string;
  deleteLabel: string;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <span className="inline-flex gap-1">
      <Button variant="ghost" size="icon" onClick={onEdit} aria-label={editLabel} title={editLabel} data-row-action="edit">
        <Pencil aria-hidden />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        onClick={onDelete}
        data-row-action="delete"
        aria-label={deleteLabel}
        title={deleteLabel}
        className="hover:bg-danger-50 hover:text-danger-700"
      >
        <Trash2 aria-hidden />
      </Button>
    </span>
  );
}

export function statusFilterOptions(t: ReturnType<typeof useI18n>["t"]) {
  return [
    { value: "", label: t("common.all") },
    { value: "true", label: t("status.active") },
    { value: "false", label: t("status.inactive") },
  ];
}
