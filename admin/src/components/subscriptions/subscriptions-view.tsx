"use client";

import { ExternalLink, Package as PackageIcon, UserRound } from "lucide-react";
import Link from "next/link";
import { useCallback, useState } from "react";

import { ListRowsLoading } from "@/components/content/list-skeleton";
import { packageName } from "@/components/packages/package-cells";
import { StudentPicker } from "@/components/results/student-picker";
import type { ServerStudent } from "@/components/results/results-view";
import { MaskedValue } from "@/components/users/user-cells";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { DataTable, type Column } from "@/components/ui/data-table";
import { FilterBar, FilterSelect } from "@/components/ui/filter-bar";
import { FilterChip } from "@/components/ui/filter-chip";
import { PageHeader } from "@/components/ui/page-header";
import { Pagination } from "@/components/ui/pagination";
import { EmptyState } from "@/components/ui/states";
import { SUBSCRIPTION_LIST } from "@/lib/content-specs";
import { formatDateTime, formatMoney } from "@/lib/format";
import { useI18n } from "@/lib/i18n/provider";
import { activeFilterCount, type ListState } from "@/lib/list-params";
import { useListData } from "@/lib/use-list-data";
import { useListUrl } from "@/lib/use-list-url";
import type { Paginated } from "@/types/content";
import type { Package } from "@/types/packages";
import type { AdminSubscription } from "@/types/subscriptions";

import { PackagePicker } from "./package-picker";
import { SubscriptionState } from "./subscription-cells";

/** The package named by `?package=` as the server page read it: `null` = it does not exist. */
export type ServerPackage = { id: number; pkg: Package | null };

/** Subscriptions list (read-only). URL-driven list state like the other lists: the
 * server filters (student, package, effective status), sorts and pages. Status is the
 * server's `effective_status`; the student's mobile number arrives masked. No actions
 * that change a subscription. */
export function SubscriptionsView({
  data,
  state: serverState,
  student: serverStudent,
  pkg: serverPackage,
}: {
  data: Paginated<AdminSubscription>;
  state: ListState;
  student: ServerStudent | null;
  pkg: ServerPackage | null;
}) {
  const { locale, t } = useI18n();
  const { state, key: urlKey, update, pending: navigating } = useListUrl(SUBSCRIPTION_LIST);
  const goToFirstPage = useCallback(() => update({ page: 1 }, { replace: true }), [update]);
  const { data: list, reloading, identity } = useListData({
    serverData: data,
    serverState,
    urlKey,
    apiPath: "/admin/subscriptions/",
    onPageGone: goToFirstPage,
  });
  const [pickingStudent, setPickingStudent] = useState(false);
  const [pickingPackage, setPickingPackage] = useState(false);
  const rows = list?.results ?? [];
  const pending = navigating || reloading;
  const filtered = activeFilterCount(state) > 0;

  const userId = state.filters.user ? Number(state.filters.user) : null;
  const packageId = state.filters.package ? Number(state.filters.package) : null;
  // Chip names come from the server page's reads of the URL's ids only (never stale).
  const studentName = userId !== null && serverStudent?.id === userId ? (serverStudent.user?.full_name ?? null) : null;
  const packageContext = packageId !== null && serverPackage?.id === packageId ? serverPackage.pkg : null;
  const time = (iso: string) => <span className="text-ink-muted">{formatDateTime(iso, locale)}</span>;
  const rowPackageName = (row: AdminSubscription) => {
    const name = packageName(row.package, locale);
    return { text: name.text || row.package.slug, lang: name.lang };
  };

  const allColumns: Column<AdminSubscription>[] = [
    { key: "student", header: t("subscriptions.colStudent"), hideOnMobile: true, className: "min-w-44", cell: (row) => <StudentCell row={row} /> },
    {
      key: "package",
      header: t("subscriptions.colPackage"),
      className: "min-w-36",
      cell: (row) => {
        const name = rowPackageName(row);
        return packageId === row.package.id ? (
          <span lang={name.lang} className="block break-words">
            {name.text}
          </span>
        ) : (
          <button
            type="button"
            onClick={() => update({ filters: { package: String(row.package.id) } })}
            className="block rounded-control text-left break-words text-ink hover:text-brand-700 hover:underline"
            aria-label={t("subscriptions.packageSubscriptions", { name: name.text })}
          >
            <span lang={name.lang}>{name.text}</span>
          </button>
        );
      },
    },
    { key: "status", header: t("subscriptions.colStatus"), cell: (row) => <SubscriptionState subscription={row} /> },
    { key: "starts", header: t("subscriptions.colStarts"), sortField: "starts_at", cell: (row) => time(row.starts_at) },
    { key: "expires", header: t("subscriptions.colExpires"), sortField: "expires_at", cell: (row) => time(row.expires_at) },
    {
      key: "paid",
      header: t("subscriptions.colPaid"),
      cell: (row) => <span className="whitespace-nowrap tabular-nums">{formatMoney(row.price_paid, row.currency, locale)}</span>,
    },
  ];
  // Filtered by one package, every row has that package (named in the chip).
  const columns = packageId === null ? allColumns : allColumns.filter((column) => column.key !== "package");

  return (
    <div className="space-y-6">
      <PageHeader title={t("subscriptions.title")} subtitle={t("subscriptions.subtitle")} />

      <div className="flex flex-wrap items-center gap-2" aria-label={t("list.filters")} role="group">
        {userId === null ? (
          <Button variant="secondary" onClick={() => setPickingStudent(true)} aria-haspopup="dialog">
            <UserRound aria-hidden />
            {t("results.chooseStudent")}
          </Button>
        ) : (
          <FilterChip
            label={studentName ?? t("results.studentUnknown", { id: userId })}
            prefix={t("results.studentFilter")}
            clearLabel={t("results.clearStudent")}
            onClear={() => update({ filters: { user: "" } })}
            extra={
              <Button variant="ghost" size="sm" onClick={() => setPickingStudent(true)} aria-haspopup="dialog">
                {t("results.changeStudent")}
              </Button>
            }
          />
        )}
        {packageId === null ? (
          <Button variant="secondary" onClick={() => setPickingPackage(true)} aria-haspopup="dialog">
            <PackageIcon aria-hidden />
            {t("subscriptions.choosePackage")}
          </Button>
        ) : (
          <FilterChip
            label={packageContext ? packageName(packageContext, locale).text || packageContext.slug : t("subscriptions.packageUnknown", { id: packageId })}
            prefix={t("subscriptions.packageFilter")}
            clearLabel={t("subscriptions.clearPackage")}
            onClear={() => update({ filters: { package: "" } })}
            extra={
              <Button variant="ghost" size="sm" onClick={() => setPickingPackage(true)} aria-haspopup="dialog">
                {t("subscriptions.changePackage")}
              </Button>
            }
          />
        )}
      </div>

      <Card {...identity}>
        <FilterBar
          activeCount={activeFilterCount(state)}
          onClear={() => update({ filters: { user: "", package: "", effective_status: "" } })}
          filters={(prefix) => (
            <>
              <FilterSelect
                id={`${prefix}-status`}
                label={t("subscriptions.statusFilter")}
                value={state.filters.effective_status ?? ""}
                onChange={(value) => update({ filters: { effective_status: value } })}
                options={[
                  { value: "", label: t("subscriptions.allStatuses") },
                  { value: "active", label: t("effective.active") },
                  { value: "scheduled", label: t("effective.scheduled") },
                  { value: "expired", label: t("effective.expired") },
                  { value: "cancelled", label: t("effective.cancelled") },
                ]}
                className="md:w-48"
              />
              <FilterSelect
                id={`${prefix}-ordering`}
                label={t("list.sort")}
                value={state.ordering}
                onChange={(ordering) => update({ ordering })}
                options={[
                  { value: "-created_at", label: t("subscriptions.newest") },
                  { value: "created_at", label: t("subscriptions.oldest") },
                  { value: "starts_at", label: t("subscriptions.startsSoonest") },
                  { value: "-starts_at", label: t("subscriptions.startsLatest") },
                  { value: "expires_at", label: t("subscriptions.expiresSoonest") },
                  { value: "-expires_at", label: t("subscriptions.expiresLatest") },
                ]}
                className="md:w-60"
              />
            </>
          )}
        />
        {list === null ? (
          <ListRowsLoading label={t("list.updating")} />
        ) : list.results.length ? (
          <DataTable
            caption={t("subscriptions.title")}
            rows={rows}
            rowKey={(row) => row.id}
            columns={columns}
            ordering={state.ordering}
            onSort={(ordering) => update({ ordering })}
            busy={pending}
            mobileTitle={(row) => <StudentCell row={row} />}
            actions={(row) => (
              <span className="inline-flex gap-1">
                {userId !== row.user.id && (
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => update({ filters: { user: String(row.user.id) } })}
                    aria-label={t("subscriptions.studentSubscriptions", { name: row.user.full_name })}
                    title={t("subscriptions.studentSubscriptions", { name: row.user.full_name })}
                    data-row-action="student"
                  >
                    <UserRound aria-hidden />
                  </Button>
                )}
                <Button asChild variant="ghost" size="icon">
                  <Link
                    href={`/subscriptions/${row.id}`}
                    aria-label={t("subscriptions.openLabel", { name: row.user.full_name })}
                    title={t("subscriptions.openLabel", { name: row.user.full_name })}
                    data-row-action="open"
                  >
                    <ExternalLink aria-hidden />
                  </Link>
                </Button>
              </span>
            )}
          />
        ) : filtered ? (
          <EmptyState title={t("subscriptions.noMatch")} description={t("subscriptions.noMatchHint")} />
        ) : (
          <EmptyState title={t("subscriptions.empty")} description={t("subscriptions.emptyHint")} />
        )}
        {list && (
          <Pagination
            page={state.page}
            pageSize={state.pageSize}
            count={list.count}
            disabled={pending}
            onPage={(page) => update({ page })}
            onPageSize={(pageSize) => update({ pageSize })}
          />
        )}
      </Card>

      <StudentPicker
        open={pickingStudent}
        onOpenChange={setPickingStudent}
        onSelect={(user) => {
          setPickingStudent(false);
          update({ filters: { user: String(user.id) } });
        }}
      />
      <PackagePicker
        open={pickingPackage}
        onOpenChange={setPickingPackage}
        onSelect={(pkg) => {
          setPickingPackage(false);
          update({ filters: { package: String(pkg.id) } });
        }}
      />
    </div>
  );
}

/** Student name (linked to the subscription) and the masked mobile number. */
function StudentCell({ row }: { row: AdminSubscription }) {
  return (
    <Link href={`/subscriptions/${row.id}`} className="group block min-w-0 rounded-control">
      <span className="block font-medium break-words text-ink group-hover:text-brand-700 group-hover:underline">{row.user.full_name}</span>
      <span className="block text-xs text-ink-subtle">
        <MaskedValue value={row.user.mobile_display} />
      </span>
    </Link>
  );
}
