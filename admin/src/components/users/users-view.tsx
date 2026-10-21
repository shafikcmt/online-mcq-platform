"use client";

import { ExternalLink } from "lucide-react";
import Link from "next/link";
import { useCallback } from "react";

import { ActiveBadge } from "@/components/content/catalog-cells";
import { ListRowsLoading } from "@/components/content/list-skeleton";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { DataTable, type Column } from "@/components/ui/data-table";
import { FilterBar, FilterSelect, SearchInput } from "@/components/ui/filter-bar";
import { PageHeader } from "@/components/ui/page-header";
import { Pagination } from "@/components/ui/pagination";
import { EmptyState } from "@/components/ui/states";
import { USER_LIST } from "@/lib/content-specs";
import { formatDateTime } from "@/lib/format";
import { useI18n } from "@/lib/i18n/provider";
import { activeFilterCount, type ListState } from "@/lib/list-params";
import { useListData } from "@/lib/use-list-data";
import { useListUrl } from "@/lib/use-list-url";
import type { Paginated } from "@/types/content";
import type { AdminUser } from "@/types/users";

import { ContactCell, RoleBadge, UserName, VerifiedBadge, languageKey } from "./user-cells";

/** Users list (read-only). Same URL-driven list state as the other lists: the server
 * filters, searches (name, mobile number, email), sorts and pages. Contact details are
 * shown exactly as the API masks them. No edit, delete or deactivate. */
export function UsersView({ data, state: serverState }: { data: Paginated<AdminUser>; state: ListState }) {
  const { locale, t } = useI18n();
  const { state, key: urlKey, update, pending: navigating } = useListUrl(USER_LIST);
  const goToFirstPage = useCallback(() => update({ page: 1 }, { replace: true }), [update]);
  const { data: list, reloading, identity } = useListData({
    serverData: data,
    serverState,
    urlKey,
    apiPath: "/admin/users/",
    onPageGone: goToFirstPage,
  });
  const rows = list?.results ?? [];
  const pending = navigating || reloading;
  const filtered = Boolean(state.search) || activeFilterCount(state) > 0;

  const columns: Column<AdminUser>[] = [
    {
      key: "user",
      header: t("users.colUser"),
      sortField: "full_name",
      hideOnMobile: true,
      className: "min-w-44",
      cell: (row) => <UserLink user={row} />,
    },
    { key: "role", header: t("users.colRole"), cell: (row) => <RoleBadge role={row.role} /> },
    { key: "contact", header: t("users.colContact"), className: "min-w-44", cell: (row) => <ContactCell user={row} /> },
    { key: "language", header: t("users.colLanguage"), cell: (row) => t(languageKey(row.preferred_language)) },
    { key: "verified", header: t("users.colVerified"), cell: (row) => <VerifiedBadge verified={row.is_mobile_verified} /> },
    { key: "status", header: t("field.status"), cell: (row) => <ActiveBadge active={row.is_active} /> },
    {
      key: "joined",
      header: t("users.colJoined"),
      sortField: "date_joined",
      sortFirst: "desc",
      className: "min-w-28",
      cell: (row) => <span className="text-ink-muted">{formatDateTime(row.date_joined, locale)}</span>,
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader title={t("users.title")} subtitle={t("users.subtitle")} />
      <Card {...identity}>
        <FilterBar
          search={
            <SearchInput
              id="users-search"
              label={t("list.search")}
              placeholder={t("users.search")}
              value={state.search}
              onChange={(search) => update({ search }, { replace: true })}
            />
          }
          activeCount={activeFilterCount(state)}
          onClear={() => update({ search: "", filters: { role: "", is_active: "" } })}
          filters={(prefix) => (
            <>
              <FilterSelect
                id={`${prefix}-role`}
                label={t("users.roleFilter")}
                value={state.filters.role ?? ""}
                onChange={(value) => update({ filters: { role: value } })}
                options={[
                  { value: "", label: t("users.allRoles") },
                  { value: "student", label: t("role.student") },
                  { value: "admin", label: t("role.admin") },
                ]}
                className="md:w-44"
              />
              <FilterSelect
                id={`${prefix}-active`}
                label={t("users.statusFilter")}
                value={state.filters.is_active ?? ""}
                onChange={(value) => update({ filters: { is_active: value } })}
                options={[
                  { value: "", label: t("users.allStatuses") },
                  { value: "true", label: t("users.activeOnly") },
                  { value: "false", label: t("users.inactiveOnly") },
                ]}
                className="md:w-48"
              />
              <FilterSelect
                id={`${prefix}-ordering`}
                label={t("list.sort")}
                value={state.ordering}
                onChange={(ordering) => update({ ordering })}
                options={[
                  { value: "-date_joined", label: t("users.newestFirst") },
                  { value: "date_joined", label: t("users.oldestFirst") },
                  { value: "full_name", label: t("users.nameAsc") },
                  { value: "-full_name", label: t("users.nameDesc") },
                ]}
                className="md:w-48"
              />
            </>
          )}
        />
        {list === null ? (
          <ListRowsLoading label={t("list.updating")} />
        ) : list.results.length ? (
          <DataTable
            caption={t("users.title")}
            rows={rows}
            rowKey={(row) => row.id}
            columns={columns}
            ordering={state.ordering}
            onSort={(ordering) => update({ ordering })}
            busy={pending}
            mobileTitle={(row) => <UserLink user={row} />}
            actions={(row) => (
              <Button asChild variant="ghost" size="icon">
                <Link
                  href={`/users/${row.id}`}
                  aria-label={t("users.openLabel", { name: row.full_name })}
                  title={t("users.openLabel", { name: row.full_name })}
                  data-row-action="open"
                >
                  <ExternalLink aria-hidden />
                </Link>
              </Button>
            )}
          />
        ) : filtered ? (
          <EmptyState title={t("users.noMatch")} description={t("users.noMatchHint")} />
        ) : (
          <EmptyState title={t("users.empty")} description={t("users.emptyHint")} />
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

function UserLink({ user }: { user: AdminUser }) {
  return (
    <Link href={`/users/${user.id}`} className="group block min-w-0 rounded-control">
      <UserName user={user} linked />
    </Link>
  );
}
