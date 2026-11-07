"use client";

import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { useState, type FormEvent } from "react";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { DateTimeText } from "@/components/ui/date-time";
import { Field, FormSection, Input } from "@/components/ui/form";
import { PageHeader } from "@/components/ui/page-header";
import { StatusBadge } from "@/components/ui/status-badge";
import { useToast } from "@/components/ui/toast";
import { apiFetch } from "@/lib/api/client";
import { describeError } from "@/lib/api/errors";
import { formatMoney } from "@/lib/format";
import { useI18n } from "@/lib/i18n/provider";
import type { MessageKey } from "@/lib/i18n/messages";
import type { AdminSubscription } from "@/types/subscriptions";
import type { Paginated } from "@/types/content";
import type { AdminUser } from "@/types/users";
import type { Tester } from "@/types/gateways";

/** Tester accounts (the only ones who can pay through sandbox gateways) and the test
 * subscriptions their sandbox payments created. Test subscriptions are listed only here:
 * they never appear among real subscriptions or in any total. Revoking one cancels it at
 * once; the sandbox payment stays recorded as the proof needed to go live. */
export function TestingView({ testers: initialTesters, subscriptions: initialSubs }: { testers: Tester[]; subscriptions: AdminSubscription[] }) {
  const { t, locale } = useI18n();
  const { notify } = useToast();
  const [testers, setTesters] = useState(initialTesters);
  const [subs, setSubs] = useState(initialSubs);
  const [query, setQuery] = useState("");
  const [found, setFound] = useState<AdminUser[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [removing, setRemoving] = useState<Tester | null>(null);
  const [revoking, setRevoking] = useState<AdminSubscription | null>(null);
  const isTester = (id: number) => testers.some((tester) => tester.user_id === id);

  async function search(event: FormEvent) {
    event.preventDefault();
    const text = query.trim();
    if (!text || searching) return;
    setSearching(true);
    setSearchError("");
    try {
      const params = new URLSearchParams({ role: "student", search: text, page_size: "10" });
      const result = await apiFetch<Paginated<AdminUser>>(`/admin/users/?${params}`);
      setFound(result.results);
    } catch (failure) {
      setFound(null);
      setSearchError(describeError(failure, t));
    } finally {
      setSearching(false);
    }
  }

  async function addTester(user: AdminUser) {
    try {
      const added = await apiFetch<Tester>("/admin/payment-testers/", { method: "POST", body: { user_id: user.id } });
      setTesters((rows) => [added, ...rows.filter((row) => row.user_id !== added.user_id)]);
      notify(t("gwt.added"));
    } catch (failure) {
      setSearchError(describeError(failure, t));
    }
  }

  async function removeTester() {
    if (!removing) return;
    await apiFetch(`/admin/payment-testers/${removing.user_id}/`, { method: "DELETE" });
    setTesters((rows) => rows.filter((row) => row.user_id !== removing.user_id));
    setRemoving(null);
    notify(t("gwt.removed"));
  }

  async function revoke() {
    if (!revoking) return;
    await apiFetch(`/admin/test-subscriptions/${revoking.id}/revoke/`, { method: "POST" });
    setSubs((rows) => rows.map((row) => (row.id === revoking.id ? { ...row, status: "cancelled", effective_status: "cancelled" } : row)));
    setRevoking(null);
    notify(t("gwt.revoked"));
  }

  return (
    <div className="space-y-6">
      <Link href="/payment-gateways" className="inline-flex items-center gap-1.5 text-sm text-ink-muted hover:text-ink">
        <ArrowLeft className="size-4" aria-hidden />
        {t("gw.back")}
      </Link>
      <PageHeader title={t("gwt.title")} subtitle={t("gwt.subtitle")} />

      <FormSection title={t("gwt.testersTitle")} description={t("gwt.testersHint")}>
        {testers.length === 0 ? (
          <p className="text-sm text-ink-muted">{t("gwt.testersEmpty")}</p>
        ) : (
          <ul className="divide-y divide-line">
            {testers.map((tester) => (
              <li key={tester.user_id} className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-sm">
                <span>
                  <span className="font-medium text-ink">{tester.full_name}</span>
                  <span className="text-ink-muted"> · {tester.mobile_number}</span>
                </span>
                <Button size="sm" variant="secondary" onClick={() => setRemoving(tester)} aria-label={`${t("gwt.remove")}: ${tester.full_name}`}>
                  {t("gwt.remove")}
                </Button>
              </li>
            ))}
          </ul>
        )}

        <form onSubmit={search} className="space-y-3 border-t border-line pt-4" role="search">
          <div className="flex flex-wrap items-end gap-3">
            <Field id="tester-search" label={t("gwt.search")} hint={t("gwt.searchHint")} className="min-w-56 flex-1">
              <Input id="tester-search" value={query} onChange={(event) => setQuery(event.target.value)} />
            </Field>
            <Button type="submit" variant="secondary" disabled={searching || !query.trim()}>
              {t("gwt.searchGo")}
            </Button>
          </div>
          {searchError ? <Alert tone="danger" live>{searchError}</Alert> : null}
          {found && found.length === 0 ? <p className="text-sm text-ink-muted">{t("gwt.searchNone")}</p> : null}
          {found && found.length ? (
            <ul className="divide-y divide-line rounded-card border border-line">
              {found.map((user) => (
                <li key={user.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
                  <span>
                    <span className="font-medium text-ink">{user.full_name}</span>
                    <span className="text-ink-muted"> · {user.mobile_display}</span>
                  </span>
                  {isTester(user.id) ? (
                    <span className="text-xs text-ink-subtle">{t("gwt.already")}</span>
                  ) : (
                    <Button size="sm" type="button" onClick={() => addTester(user)} aria-label={`${t("gwt.add")}: ${user.full_name}`}>
                      {t("gwt.add")}
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          ) : null}
        </form>
      </FormSection>

      <FormSection title={t("gwt.subsTitle")} description={t("gwt.subsHint")}>
        {subs.length === 0 ? (
          <p className="text-sm text-ink-muted">{t("gwt.subsEmpty")}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[40rem] text-left text-sm">
              <thead className="text-xs text-ink-muted">
                <tr>
                  <th className="py-2 pr-3 font-medium">{t("gwt.colStudent")}</th>
                  <th className="py-2 pr-3 font-medium">{t("gwt.colPackage")}</th>
                  <th className="py-2 pr-3 font-medium">{t("gwt.colStatus")}</th>
                  <th className="py-2 pr-3 font-medium">{t("gwt.colExpires")}</th>
                  <th className="py-2 font-medium">
                    <span className="sr-only">{t("gwt.revoke")}</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {subs.map((sub) => {
                  const running = sub.effective_status === "active" || sub.effective_status === "scheduled";
                  return (
                    <tr key={sub.id}>
                      <td className="py-2.5 pr-3">
                        <span className="font-medium text-ink">{sub.user.full_name}</span>
                        <span className="block text-xs text-ink-muted">{sub.user.mobile_display}</span>
                      </td>
                      <td className="py-2.5 pr-3">
                        {locale === "bn" && sub.package.name_bn ? sub.package.name_bn : sub.package.name_en}
                        <span className="block text-xs text-ink-muted">{formatMoney(sub.price_paid, sub.currency, locale)}</span>
                      </td>
                      <td className="py-2.5 pr-3">
                        <StatusBadge status={sub.effective_status} label={t(`gwt.status.${sub.effective_status}` as MessageKey)} />
                      </td>
                      <td className="py-2.5 pr-3">
                        <DateTimeText iso={sub.expires_at} />
                      </td>
                      <td className="py-2.5 text-right">
                        {running ? (
                          <Button size="sm" variant="danger" onClick={() => setRevoking(sub)} aria-label={`${t("gwt.revoke")}: ${sub.user.full_name}`}>
                            {t("gwt.revoke")}
                          </Button>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </FormSection>

      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(open) => !open && setRemoving(null)}
        title={t("gwt.removeTitle")}
        description={t("gwt.removeText", { name: removing?.full_name ?? "" })}
        confirmLabel={t("gwt.remove")}
        onConfirm={removeTester}
      />
      <ConfirmDialog
        open={revoking !== null}
        onOpenChange={(open) => !open && setRevoking(null)}
        title={t("gwt.revokeTitle")}
        description={t("gwt.revokeText", { name: revoking?.user.full_name ?? "" })}
        confirmLabel={t("gwt.revokeConfirm")}
        onConfirm={revoke}
      />
    </div>
  );
}
