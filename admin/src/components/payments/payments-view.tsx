"use client";

import { ExternalLink, Package as PackageIcon, UserRound } from "lucide-react";
import Link from "next/link";
import { useCallback, useState } from "react";

import { ListRowsLoading } from "@/components/content/list-skeleton";
import { packageName } from "@/components/packages/package-cells";
import { StudentPicker } from "@/components/results/student-picker";
import type { ServerStudent } from "@/components/results/results-view";
import { PackagePicker } from "@/components/subscriptions/package-picker";
import type { ServerPackage } from "@/components/subscriptions/subscriptions-view";
import { MaskedValue } from "@/components/users/user-cells";
import { ModeBadge } from "@/components/gateways/gateway-parts";
import { DateTimeText } from "@/components/ui/date-time";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { DataTable, type Column } from "@/components/ui/data-table";
import { FilterBar, FilterSelect, SearchInput } from "@/components/ui/filter-bar";
import { FilterChip } from "@/components/ui/filter-chip";
import { PageHeader } from "@/components/ui/page-header";
import { Pagination } from "@/components/ui/pagination";
import { EmptyState } from "@/components/ui/states";
import { PAYMENT_LIST } from "@/lib/content-specs";
import { formatDateTime, formatMoney } from "@/lib/format";
import { useI18n } from "@/lib/i18n/provider";
import { activeFilterCount, type ListState } from "@/lib/list-params";
import { useListData } from "@/lib/use-list-data";
import { useListUrl } from "@/lib/use-list-url";
import type { Paginated } from "@/types/content";
import { PAYMENT_PROVIDERS, PAYMENT_STATUSES, type AdminPayment } from "@/types/payments";
import type { AdminSubscription } from "@/types/subscriptions";

import { PaymentState, codeLabel } from "./payment-cells";

/** The subscription named by `?subscription=` as the server page read it: `null` = it
 * does not exist. */
export type ServerSubscription = { id: number; subscription: AdminSubscription | null };

/** Payments list (read-only). URL-driven list state like the other lists: the server
 * filters (student, package, subscription, status, provider), searches (exact merchant
 * reference or provider transaction ID only), sorts and pages. Status and reason are the
 * server's codes; the mobile number arrives masked. No action changes a payment. */
export function PaymentsView({
  data,
  state: serverState,
  student: serverStudent,
  pkg: serverPackage,
  subscription: serverSubscription,
}: {
  data: Paginated<AdminPayment>;
  state: ListState;
  student: ServerStudent | null;
  pkg: ServerPackage | null;
  subscription: ServerSubscription | null;
}) {
  const { locale, t } = useI18n();
  const { state, key: urlKey, update, pending: navigating } = useListUrl(PAYMENT_LIST);
  const goToFirstPage = useCallback(() => update({ page: 1 }, { replace: true }), [update]);
  const { data: list, reloading, identity } = useListData({
    serverData: data,
    serverState,
    urlKey,
    apiPath: "/admin/payments/",
    onPageGone: goToFirstPage,
  });
  const [pickingStudent, setPickingStudent] = useState(false);
  const [pickingPackage, setPickingPackage] = useState(false);
  const rows = list?.results ?? [];
  const pending = navigating || reloading;
  const filtered = activeFilterCount(state) > 0 || Boolean(state.search);

  const userId = state.filters.user ? Number(state.filters.user) : null;
  const packageId = state.filters.package ? Number(state.filters.package) : null;
  const subscriptionId = state.filters.subscription ? Number(state.filters.subscription) : null;
  const gatewayId = state.filters.gateway ? Number(state.filters.gateway) : null;
  // The gateway chip's name comes from a row of the list itself (every row carries its gateway).
  const gatewayRow = gatewayId === null ? undefined : rows.find((row) => row.gateway?.id === gatewayId)?.gateway;
  const gatewayLabel = (gateway: NonNullable<AdminPayment["gateway"]>) =>
    (locale === "bn" && gateway.name_bn) || gateway.name_en || gateway.slug;
  // Chip names come from the server page's reads of the URL's ids only (never stale).
  const studentName = userId !== null && serverStudent?.id === userId ? (serverStudent.user?.full_name ?? null) : null;
  const packageContext = packageId !== null && serverPackage?.id === packageId ? serverPackage.pkg : null;
  const subscriptionContext =
    subscriptionId !== null && serverSubscription?.id === subscriptionId ? serverSubscription.subscription : null;
  const rowPackageName = (row: AdminPayment) => {
    const name = packageName(row.package, locale);
    return { text: name.text || row.package.slug, lang: name.lang };
  };

  const allColumns: Column<AdminPayment>[] = [
    { key: "reference", header: t("payments.colReference"), hideOnMobile: true, className: "min-w-36 max-w-44", cell: (row) => <ReferenceCell row={row} /> },
    { key: "student", header: t("payments.colStudent"), className: "min-w-36", cell: (row) => <StudentCell row={row} /> },
    {
      key: "package",
      header: t("payments.colPackage"),
      className: "min-w-28",
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
            aria-label={t("payments.packagePayments", { name: name.text })}
          >
            <span lang={name.lang}>{name.text}</span>
          </button>
        );
      },
    },
    {
      key: "amount",
      header: t("payments.colAmount"),
      sortField: "amount",
      sortFirst: "desc",
      cell: (row) => (
        <span className="block">
          <span className="block whitespace-nowrap tabular-nums">{formatMoney(row.amount, row.currency, locale)}</span>
          <span className="block text-xs text-ink-subtle">{codeLabel(t, "payProvider", row.provider)}</span>
          {row.gateway ? (
            <button
              type="button"
              onClick={() => update({ filters: { gateway: String(row.gateway!.id) } })}
              className="block rounded-control text-left text-xs break-words text-ink-muted hover:text-brand-700 hover:underline"
              aria-label={t("payments.gatewayPayments", { name: gatewayLabel(row.gateway) })}
            >
              {gatewayLabel(row.gateway)}
            </button>
          ) : null}
          <span className="mt-0.5 flex flex-wrap items-center gap-1">
            {row.mode ? <ModeBadge mode={row.mode} /> : null}
            {row.channel ? <span className="text-xs text-ink-subtle">{t(`payments.channel.${row.channel}`)}</span> : null}
          </span>
        </span>
      ),
    },
    { key: "status", header: t("payments.colStatus"), className: "min-w-28", cell: (row) => <PaymentState status={row.status} reason={row.failure_reason} /> },
    {
      key: "created",
      header: t("payments.colCreated"),
      sortField: "created_at",
      sortFirst: "desc",
      cell: (row) => (
        <span className="block text-ink-muted">
          <span className="block"><DateTimeText iso={row.created_at} /></span>
          {row.verified_at && (
            <span className="block text-xs text-ink-subtle">{t("payments.verifiedAt", { time: formatDateTime(row.verified_at, locale) })}</span>
          )}
        </span>
      ),
    },
  ];
  // Filtered by one package, every row has that package (named in the chip).
  const columns = packageId === null ? allColumns : allColumns.filter((column) => column.key !== "package");

  return (
    <div className="space-y-6">
      <PageHeader title={t("payments.title")} subtitle={t("payments.subtitle")} />

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
            label={packageContext ? packageName(packageContext, locale).text || packageContext.slug : t("payments.packageUnknown", { id: packageId })}
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
        {gatewayId !== null && (
          <FilterChip
            label={gatewayRow ? gatewayLabel(gatewayRow) : t("payments.gatewayUnknown", { id: gatewayId })}
            prefix={t("payments.gatewayFilter")}
            clearLabel={t("payments.clearGateway")}
            onClear={() => update({ filters: { gateway: "" } })}
          />
        )}
        {subscriptionId !== null && (
          <FilterChip
            label={
              subscriptionContext
                ? t("payments.subscriptionChip", {
                    id: subscriptionContext.id,
                    name: subscriptionContext.user.full_name,
                    package: packageName(subscriptionContext.package, locale).text || subscriptionContext.package.slug,
                  })
                : t("payments.subscriptionUnknown", { id: subscriptionId })
            }
            prefix={t("payments.subscriptionFilter")}
            clearLabel={t("payments.clearSubscription")}
            onClear={() => update({ filters: { subscription: "" } })}
          />
        )}
      </div>

      <Card {...identity}>
        <FilterBar
          search={
            <SearchInput
              id="payments-search"
              label={t("payments.searchLabel")}
              placeholder={t("payments.searchPlaceholder")}
              value={state.search}
              onChange={(search) => update({ search }, { replace: true })}
            />
          }
          activeCount={activeFilterCount(state)}
          onClear={() => update({ search: "", filters: { user: "", package: "", subscription: "", gateway: "", status: "", provider: "", mode: "", channel: "" } })}
          filters={(prefix) => (
            <>
              <FilterSelect
                id={`${prefix}-status`}
                label={t("payments.statusFilter")}
                value={state.filters.status ?? ""}
                onChange={(value) => update({ filters: { status: value } })}
                options={[
                  { value: "", label: t("payments.allStatuses") },
                  ...PAYMENT_STATUSES.map((status) => ({ value: status, label: t(`paymentStatus.${status}`) })),
                ]}
                className="md:w-44"
              />
              <FilterSelect
                id={`${prefix}-provider`}
                label={t("payments.providerFilter")}
                value={state.filters.provider ?? ""}
                onChange={(value) => update({ filters: { provider: value } })}
                options={[
                  { value: "", label: t("payments.allProviders") },
                  ...PAYMENT_PROVIDERS.map((provider) => ({ value: provider, label: t(`payProvider.${provider}`) })),
                ]}
                className="md:w-48"
              />
              <FilterSelect
                id={`${prefix}-mode`}
                label={t("payments.modeFilter")}
                value={state.filters.mode ?? ""}
                onChange={(value) => update({ filters: { mode: value } })}
                options={[
                  { value: "", label: t("payments.allModes") },
                  { value: "live", label: t("gw.mode.live") },
                  { value: "sandbox", label: t("gw.mode.sandbox") },
                ]}
                className="md:w-40"
              />
              <FilterSelect
                id={`${prefix}-channel`}
                label={t("payments.channelFilter")}
                value={state.filters.channel ?? ""}
                onChange={(value) => update({ filters: { channel: value } })}
                options={[
                  { value: "", label: t("payments.allChannels") },
                  { value: "web", label: t("payments.channel.web") },
                  { value: "app", label: t("payments.channel.app") },
                ]}
                className="md:w-40"
              />
              <FilterSelect
                id={`${prefix}-ordering`}
                label={t("list.sort")}
                value={state.ordering}
                onChange={(ordering) => update({ ordering })}
                options={[
                  { value: "-created_at", label: t("payments.newest") },
                  { value: "created_at", label: t("payments.oldest") },
                  { value: "-amount", label: t("payments.amountHigh") },
                  { value: "amount", label: t("payments.amountLow") },
                  { value: "-verified_at", label: t("payments.verifiedNewest") },
                  { value: "verified_at", label: t("payments.verifiedOldest") },
                ]}
                className="md:w-56"
              />
            </>
          )}
        />
        {list === null ? (
          <ListRowsLoading label={t("list.updating")} />
        ) : list.results.length ? (
          <DataTable
            caption={t("payments.title")}
            rows={rows}
            rowKey={(row) => row.payment_id}
            columns={columns}
            ordering={state.ordering}
            onSort={(ordering) => update({ ordering })}
            busy={pending}
            mobileTitle={(row) => <ReferenceCell row={row} />}
            actions={(row) => (
              <span className="inline-flex gap-1">
                {userId !== row.user.id && (
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => update({ filters: { user: String(row.user.id) } })}
                    aria-label={t("payments.studentPayments", { name: row.user.full_name })}
                    title={t("payments.studentPayments", { name: row.user.full_name })}
                    data-row-action="student"
                  >
                    <UserRound aria-hidden />
                  </Button>
                )}
                <Button asChild variant="ghost" size="icon">
                  <Link
                    href={`/payments/${row.payment_id}`}
                    aria-label={t("payments.openLabel", { reference: row.merchant_reference })}
                    title={t("payments.openLabel", { reference: row.merchant_reference })}
                    data-row-action="open"
                  >
                    <ExternalLink aria-hidden />
                  </Link>
                </Button>
              </span>
            )}
          />
        ) : filtered ? (
          <EmptyState title={t("payments.noMatch")} description={state.search ? t("payments.noMatchHint") : t("subscriptions.noMatchHint")} />
        ) : (
          <EmptyState title={t("payments.empty")} description={t("payments.emptyHint")} />
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
        selectText={t("payments.selectStudent")}
        selectLabel={(name) => t("payments.selectStudentLabel", { name })}
        onSelect={(user) => {
          setPickingStudent(false);
          update({ filters: { user: String(user.id) } });
        }}
      />
      <PackagePicker
        open={pickingPackage}
        onOpenChange={setPickingPackage}
        selectText={t("payments.selectPackage")}
        selectLabel={(name) => t("payments.selectPackageLabel", { name })}
        onSelect={(pkg) => {
          setPickingPackage(false);
          update({ filters: { package: String(pkg.id) } });
        }}
      />
    </div>
  );
}

/** The merchant reference, linked to the payment. */
function ReferenceCell({ row }: { row: AdminPayment }) {
  return (
    <Link href={`/payments/${row.payment_id}`} className="block rounded-control font-mono text-xs break-all text-ink hover:text-brand-700 hover:underline">
      {row.merchant_reference}
    </Link>
  );
}

/** Student name and the masked mobile number. */
function StudentCell({ row }: { row: AdminPayment }) {
  return (
    <span className="block min-w-0">
      <span className="block font-medium break-words text-ink">{row.user.full_name}</span>
      <span className="block text-xs whitespace-nowrap text-ink-subtle">
        <MaskedValue value={row.user.mobile_display} />
      </span>
    </span>
  );
}
