"use client";

import { ExternalLink, Plus } from "lucide-react";
import Link from "next/link";
import { useCallback } from "react";

import { ListRowsLoading } from "@/components/content/list-skeleton";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { DataTable, type Column } from "@/components/ui/data-table";
import { FilterBar, FilterSelect, SearchInput } from "@/components/ui/filter-bar";
import { PageHeader } from "@/components/ui/page-header";
import { Pagination } from "@/components/ui/pagination";
import { EmptyState } from "@/components/ui/states";
import { PACKAGE_LIST } from "@/lib/content-specs";
import { formatNumber } from "@/lib/format";
import { useI18n } from "@/lib/i18n/provider";
import { activeFilterCount, type ListState } from "@/lib/list-params";
import { useListData } from "@/lib/use-list-data";
import { useListUrl } from "@/lib/use-list-url";
import type { Paginated } from "@/types/content";
import type { Package } from "@/types/packages";

import { FeaturedBadge, PackageStatusBadge, Price, Validity, packageName } from "./package-cells";

/** Packages list. Same URL-driven list state as the other lists: the server searches
 * (names, slug), filters, sorts and pages. Counts come with each row (no per-row reads). */
export function PackagesView({ data, state: serverState }: { data: Paginated<Package>; state: ListState }) {
  const { locale, t } = useI18n();
  const { state, key: urlKey, update, pending: navigating } = useListUrl(PACKAGE_LIST);
  const goToFirstPage = useCallback(() => update({ page: 1 }, { replace: true }), [update]);
  const { data: list, reloading, identity } = useListData({
    serverData: data,
    serverState,
    urlKey,
    apiPath: "/admin/packages/",
    onPageGone: goToFirstPage,
  });
  const rows = list?.results ?? [];
  const pending = navigating || reloading;
  const filtered = Boolean(state.search) || activeFilterCount(state) > 0;
  const n = (value: number) => formatNumber(value, locale);

  const columns: Column<Package>[] = [
    { key: "name", header: t("packages.colName"), hideOnMobile: true, className: "min-w-48", cell: (row) => <NameCell pkg={row} /> },
    { key: "price", header: t("packages.colPrice"), sortField: "price", cell: (row) => <Price pkg={row} /> },
    { key: "validity", header: t("packages.colValidity"), sortField: "validity_days", cell: (row) => <Validity days={row.validity_days} /> },
    {
      key: "status",
      header: t("packages.colStatus"),
      cell: (row) => (
        <span className="flex flex-wrap gap-1.5">
          <PackageStatusBadge status={row.status} />
          {row.is_featured && <FeaturedBadge />}
        </span>
      ),
    },
    {
      key: "rules",
      header: t("packages.colRules"),
      cell: (row) =>
        row.rule_count ? (
          <span className="tabular-nums">{t("packages.rulesCount", { n: n(row.rule_count) })}</span>
        ) : (
          <span className="text-ink-subtle">{t("packages.noRules")}</span>
        ),
    },
    { key: "subscriptions", header: t("packages.colSubscribers"), cell: (row) => <span className="tabular-nums">{n(row.subscription_count)}</span> },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("packages.title")}
        subtitle={t("packages.subtitle")}
        actions={
          <Button asChild>
            <Link href="/packages/new">
              <Plus aria-hidden />
              {t("packages.new")}
            </Link>
          </Button>
        }
      />
      <Card {...identity}>
        <FilterBar
          search={
            <SearchInput
              id="packages-search"
              label={t("list.search")}
              placeholder={t("packages.search")}
              value={state.search}
              onChange={(search) => update({ search }, { replace: true })}
            />
          }
          activeCount={activeFilterCount(state)}
          onClear={() => update({ search: "", filters: { status: "", is_featured: "" } })}
          filters={(prefix) => (
            <>
              <FilterSelect
                id={`${prefix}-status`}
                label={t("packages.statusFilter")}
                value={state.filters.status ?? ""}
                onChange={(value) => update({ filters: { status: value } })}
                options={[
                  { value: "", label: t("packages.allStatuses") },
                  { value: "active", label: t("packages.activeOnly") },
                  { value: "inactive", label: t("packages.inactiveOnly") },
                ]}
                className="md:w-48"
              />
              <FilterSelect
                id={`${prefix}-featured`}
                label={t("packages.featuredFilter")}
                value={state.filters.is_featured ?? ""}
                onChange={(value) => update({ filters: { is_featured: value } })}
                options={[
                  { value: "", label: t("packages.allFeatured") },
                  { value: "true", label: t("packages.featuredOnly") },
                  { value: "false", label: t("packages.notFeatured") },
                ]}
                className="md:w-48"
              />
              <FilterSelect
                id={`${prefix}-ordering`}
                label={t("list.sort")}
                value={state.ordering}
                onChange={(ordering) => update({ ordering })}
                options={[
                  { value: "sort_order", label: t("packages.sortOrder") },
                  { value: "price", label: t("packages.priceLow") },
                  { value: "-price", label: t("packages.priceHigh") },
                  { value: "validity_days", label: t("packages.validityShort") },
                  { value: "-validity_days", label: t("packages.validityLong") },
                  { value: "-created_at", label: t("packages.newest") },
                  { value: "-updated_at", label: t("packages.recentlyUpdated") },
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
            caption={t("packages.title")}
            rows={rows}
            rowKey={(row) => row.id}
            columns={columns}
            ordering={state.ordering}
            onSort={(ordering) => update({ ordering })}
            busy={pending}
            mobileTitle={(row) => <NameCell pkg={row} />}
            actions={(row) => {
              const name = packageName(row, locale).text || row.slug;
              return (
                <Button asChild variant="ghost" size="icon">
                  <Link href={`/packages/${row.id}`} aria-label={t("packages.openLabel", { name })} title={t("packages.openLabel", { name })} data-row-action="open">
                    <ExternalLink aria-hidden />
                  </Link>
                </Button>
              );
            }}
          />
        ) : filtered ? (
          <EmptyState title={t("packages.noMatch")} description={t("packages.noMatchHint")} />
        ) : (
          <EmptyState
            title={t("packages.empty")}
            description={t("packages.emptyHint")}
            action={
              <Button asChild>
                <Link href="/packages/new">
                  <Plus aria-hidden />
                  {t("packages.new")}
                </Link>
              </Button>
            }
          />
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
    </div>
  );
}

/** Name in the UI language (the other language underneath) and the slug, linked. */
function NameCell({ pkg }: { pkg: Package }) {
  const { locale, t } = useI18n();
  const primary = packageName(pkg, locale);
  const secondary = primary.lang === "bn" ? { text: pkg.name_en, lang: "en" } : { text: pkg.name_bn, lang: "bn" };
  return (
    <Link href={`/packages/${pkg.id}`} className="group block min-w-0 rounded-control">
      <span lang={primary.lang} className="block font-medium break-words text-ink group-hover:text-brand-700 group-hover:underline">
        {primary.text || t("packages.untitled")}
      </span>
      {secondary.text && secondary.text !== primary.text && (
        <span lang={secondary.lang} className="block text-[13px] break-words text-ink-subtle">
          {secondary.text}
        </span>
      )}
      <span className="block text-xs break-all text-ink-subtle">{pkg.slug}</span>
    </Link>
  );
}
