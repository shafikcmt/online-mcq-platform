"use client";

import { Activity, CalendarClock, CreditCard, PlayCircle, ShieldCheck, Users } from "lucide-react";
import type { ComponentType, ReactNode } from "react";

import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { StatusBadge, STATUS_TONES, TONE_BAR } from "@/components/ui/status-badge";
import { formatDateTime, formatMoney, formatNumber } from "@/lib/format";
import type { MessageKey } from "@/lib/i18n/messages";
import { useI18n } from "@/lib/i18n/provider";
import { cn } from "@/lib/utils";
import type { AdminDashboard } from "@/types/admin";

const EXAM_STATUSES = ["published", "draft", "unpublished", "archived"] as const;
const PAYMENT_STATUSES = ["success", "pending", "initiated", "failed", "cancelled"] as const;

function MetricCard({
  label,
  value,
  sub,
  icon: Icon,
}: {
  label: string;
  value: ReactNode;
  sub: ReactNode;
  icon: ComponentType<{ className?: string }>;
}) {
  return (
    <Card>
      <CardBody className="pt-5">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-sm font-medium text-ink-muted">{label}</h2>
          <span className="grid size-8 place-items-center rounded-control bg-brand-50 text-brand-600">
            <Icon className="size-4" aria-hidden />
          </span>
        </div>
        <p className="mt-2 text-[28px] leading-9 font-semibold tracking-tight text-ink tabular-nums">{value}</p>
        <p className="mt-1 text-[13px] text-ink-subtle">{sub}</p>
      </CardBody>
    </Card>
  );
}

/** A proportional bar over real counts (no invented data); hidden when the total is 0. */
function SegmentBar({ parts, label }: { parts: { key: string; value: number }[]; label: string }) {
  const total = parts.reduce((sum, part) => sum + part.value, 0);
  if (!total) return null;
  return (
    <div className="flex h-2 w-full overflow-hidden rounded-full bg-neutral-50" role="img" aria-label={label}>
      {parts
        .filter((part) => part.value > 0)
        .map((part) => (
          <span
            key={part.key}
            className={cn("h-full", TONE_BAR[STATUS_TONES[part.key]?.tone ?? "neutral"])}
            style={{ width: `${(part.value / total) * 100}%` }}
          />
        ))}
    </div>
  );
}

function StatusList({
  rows,
  locale,
}: {
  rows: { key: string; label: string; value: number }[];
  locale: "en" | "bn";
}) {
  return (
    <dl className="divide-y divide-line">
      {rows.map((row) => (
        <div key={row.key} className="flex items-center justify-between gap-3 py-2.5">
          <dt>
            <StatusBadge status={row.key} label={row.label} />
          </dt>
          <dd className="text-sm font-semibold text-ink tabular-nums">{formatNumber(row.value, locale)}</dd>
        </div>
      ))}
    </dl>
  );
}

export function DashboardView({ data }: { data: AdminDashboard }) {
  const { t, locale } = useI18n();
  const n = (value: number) => formatNumber(value, locale);
  const revenue = data.payments.revenue_this_month;

  const examRows = EXAM_STATUSES.map((key) => ({
    key,
    label: t(`status.${key}` as MessageKey),
    value: data.exams[key],
  }));
  const paymentRows = PAYMENT_STATUSES.map((key) => ({
    key,
    label: t(`status.${key}` as MessageKey),
    value: data.payments.by_status[key] ?? 0,
  }));
  const paymentTotal = paymentRows.reduce((sum, row) => sum + row.value, 0);

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("dashboard.title")}
        subtitle={
          <>
            {t("dashboard.subtitle", { tz: data.period.time_zone })}{" "}
            <span className="whitespace-nowrap text-ink-subtle">
              · {t("common.updated")} {formatDateTime(data.server_time, locale)}
            </span>
          </>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          icon={Users}
          label={t("dashboard.students")}
          value={n(data.users.students_total)}
          sub={t("dashboard.studentsActive", { n: n(data.users.students_active) })}
        />
        <MetricCard
          icon={Activity}
          label={t("dashboard.attemptsToday")}
          value={n(data.attempts.started_today)}
          sub={t("dashboard.attemptsTodaySub", {
            submitted: n(data.attempts.submitted_today),
            inProgress: n(data.attempts.in_progress),
          })}
        />
        <MetricCard
          icon={ShieldCheck}
          label={t("dashboard.activeSubs")}
          value={n(data.subscriptions.active_now)}
          sub={t("dashboard.activeSubsSub", { n: n(data.subscriptions.students_with_active) })}
        />
        <MetricCard
          icon={CreditCard}
          label={t("dashboard.revenue")}
          value={
            revenue.length ? (
              <span className="flex flex-col">
                {revenue.map((row) => (
                  <span key={row.currency}>{formatMoney(row.amount, row.currency, locale)}</span>
                ))}
              </span>
            ) : (
              formatMoney("0", "BDT", locale)
            )
          }
          sub={
            data.payments.success_this_month
              ? t("dashboard.revenueSub", { n: n(data.payments.success_this_month) })
              : t("dashboard.revenueNone")
          }
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card aria-labelledby="exams-title">
          <CardHeader>
            <div>
              <CardTitle id="exams-title">{t("dashboard.exams")}</CardTitle>
              <p className="mt-0.5 text-[13px] text-ink-subtle">{t("dashboard.examsTotal", { n: n(data.exams.total) })}</p>
            </div>
          </CardHeader>
          <CardBody className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-control border border-line bg-success-50/50 px-3.5 py-3">
                <p className="flex items-center gap-1.5 text-[13px] font-medium text-success-700">
                  <PlayCircle className="size-4" aria-hidden />
                  {t("dashboard.openNow")}
                </p>
                <p className="mt-1 text-xl font-semibold text-ink tabular-nums">{n(data.exams.open_now)}</p>
              </div>
              <div className="rounded-control border border-line bg-info-50/60 px-3.5 py-3">
                <p className="flex items-center gap-1.5 text-[13px] font-medium text-info-700">
                  <CalendarClock className="size-4" aria-hidden />
                  {t("dashboard.upcoming")}
                </p>
                <p className="mt-1 text-xl font-semibold text-ink tabular-nums">{n(data.exams.upcoming)}</p>
              </div>
            </div>
            <SegmentBar parts={examRows} label={t("dashboard.exams")} />
            <StatusList rows={examRows} locale={locale} />
          </CardBody>
        </Card>

        <Card aria-labelledby="payments-title">
          <CardHeader>
            <div>
              <CardTitle id="payments-title">{t("dashboard.payments")}</CardTitle>
              <p className="mt-0.5 text-[13px] text-ink-subtle">{t("dashboard.paymentsTotal", { n: n(paymentTotal) })}</p>
            </div>
          </CardHeader>
          <CardBody className="space-y-4">
            <SegmentBar parts={paymentRows} label={t("dashboard.payments")} />
            <StatusList rows={paymentRows} locale={locale} />
            <p className="text-xs text-ink-subtle">{t("dashboard.paymentsNote")}</p>
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
