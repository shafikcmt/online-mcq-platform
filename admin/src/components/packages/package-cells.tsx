"use client";

import { Star } from "lucide-react";

import { StatusBadge } from "@/components/ui/status-badge";
import { formatMoney, formatNumber } from "@/lib/format";
import { useI18n } from "@/lib/i18n/provider";
import { localized } from "@/lib/localized";
import type { Package } from "@/types/packages";

export function packageName(pkg: Pick<Package, "name_bn" | "name_en">, locale: "en" | "bn") {
  return localized(locale, pkg.name_bn, pkg.name_en);
}

export function PackageStatusBadge({ status }: { status: Package["status"] }) {
  const { t } = useI18n();
  return <StatusBadge status={status} label={t(status === "active" ? "status.active" : "status.inactive")} className="whitespace-nowrap" />;
}

export function FeaturedBadge() {
  const { t } = useI18n();
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-accent-50 px-2 py-0.5 text-xs font-medium whitespace-nowrap text-warning-700 ring-1 ring-warning-700/15 ring-inset">
      <Star className="size-3" aria-hidden />
      {t("packages.featured")}
    </span>
  );
}

export function Price({ pkg }: { pkg: Pick<Package, "price" | "currency"> }) {
  const { locale } = useI18n();
  return <span className="whitespace-nowrap tabular-nums">{formatMoney(pkg.price, pkg.currency, locale)}</span>;
}

export function Validity({ days }: { days: number }) {
  const { locale, t } = useI18n();
  return <span className="whitespace-nowrap">{t("packages.days", { n: formatNumber(days, locale) })}</span>;
}
