"use client";

import { Gauge, Languages } from "lucide-react";

import { useI18n } from "@/lib/i18n/provider";
import type { ContentLanguage, Difficulty } from "@/types/content";

export function LanguageBadge({ language }: { language: ContentLanguage }) {
  const { t } = useI18n();
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-brand-50 px-2.5 py-0.5 text-xs font-medium whitespace-nowrap text-brand-700 ring-1 ring-brand-700/15 ring-inset">
      <Languages className="size-3.5" aria-hidden />
      {t(`language.${language}`)}
    </span>
  );
}

export function DifficultyLabel({ difficulty }: { difficulty: Difficulty | "" }) {
  const { t } = useI18n();
  if (!difficulty) return <span className="text-ink-subtle">{t("common.notSet")}</span>;
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
      <Gauge className="size-3.5 text-ink-subtle" aria-hidden />
      {t(`difficulty.${difficulty}`)}
    </span>
  );
}
