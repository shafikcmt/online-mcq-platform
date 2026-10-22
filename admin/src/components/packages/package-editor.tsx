"use client";

import { ArrowLeft, Info, Power, PowerOff, Trash2 } from "lucide-react";
import Link from "next/link";
import { useCallback, useRef, useState, type FormEvent } from "react";

import { Alert } from "@/components/ui/alert";
import { BilingualField } from "@/components/ui/bilingual-field";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Field, FormSection, Input, Select, Switch } from "@/components/ui/form";
import { Modal } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";
import { apiFetch } from "@/lib/api/client";
import { ApiError, describeError } from "@/lib/api/errors";
import { isValidationError, mapFieldErrors, type MappedErrors } from "@/lib/api/field-errors";
import { DESCRIPTION_MAX_LENGTH, NAME_MAX_LENGTH, SLUG_MAX_LENGTH } from "@/lib/content-limits";
import { formatDateTime, formatMoney, formatNumber } from "@/lib/format";
import { useI18n } from "@/lib/i18n/provider";
import type { MessageKey } from "@/lib/i18n/messages";
import {
  PACKAGE_FIELDS,
  draftFromPackage,
  newPackageDraft,
  packageFieldErrors,
  samePackageDraft,
  toPackagePayload,
  type PackageDraft,
} from "@/lib/package-form";
import { useUnsavedGuard } from "@/lib/use-unsaved-guard";
import type { Category } from "@/types/content";
import { CURRENCIES, PACKAGE_STATUSES, type AccessRule, type Package } from "@/types/packages";

import { AccessRulesEditor } from "./access-rules-editor";
import { FeaturedBadge, PackageStatusBadge, packageName } from "./package-cells";

const NO_ERRORS: MappedErrors = { fields: {}, form: [] };

type Confirm = "activate" | "deactivate" | "delete";

/** A failed package action: `409` (in use / other conflict) → a translated title and
 * the server's own message — never turned into success; anything else → the usual text. */
export function describePackageError(error: unknown, t: (key: MessageKey) => string): { title?: string; message: string } {
  if (error instanceof ApiError && error.status === 409) {
    return {
      title: t(error.code === "in_use" ? "package.inUseTitle" : "package.conflictTitle"),
      message: error.fromServer ? error.message : t("error.generic"),
    };
  }
  if (error instanceof ApiError && error.status === 404) return { message: t("error.notFound") };
  return { message: describeError(error, t) };
}

/** Create / edit a package and its access rules. The settings and the rules are saved
 * separately (two endpoints). Status changes and delete act on the SAVED package, after a
 * confirmation; the server's answer (the package as it now is) replaces the page state. */
export function PackageEditor({
  pkg: initialPackage,
  rules,
  categories,
  lookupTruncated,
}: {
  pkg: Package | null;
  rules: AccessRule[];
  categories: Category[];
  lookupTruncated: boolean;
}) {
  const { locale, t } = useI18n();
  const { notify } = useToast();
  const [pkg, setPkg] = useState(initialPackage);
  const [saved, setSaved] = useState<PackageDraft>(() => (initialPackage ? draftFromPackage(initialPackage) : newPackageDraft()));
  const [draft, setDraft] = useState<PackageDraft>(saved);
  const [errors, setErrors] = useState<MappedErrors>(NO_ERRORS);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [rulesDirty, setRulesDirty] = useState(false);
  const summaryRef = useRef<HTMLDivElement>(null);
  const keepEditingRef = useRef<HTMLButtonElement>(null);

  const settingsDirty = !samePackageDraft(draft, saved);
  const guard = useUnsavedGuard(settingsDirty || rulesDirty);
  const set = <K extends keyof PackageDraft>(key: K, value: PackageDraft[K]) => setDraft((current) => ({ ...current, [key]: value }));
  const fields = errors.fields;
  const onRulesDirty = useCallback((dirty: boolean) => setRulesDirty(dirty), []);

  function applyPackage(next: Package) {
    setPkg(next);
    const nextDraft = draftFromPackage(next);
    setSaved(nextDraft);
    setDraft(nextDraft);
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setErrors(NO_ERRORS);
    try {
      const result = await apiFetch<Package>(pkg ? `/admin/packages/${pkg.id}/` : "/admin/packages/", {
        method: pkg ? "PATCH" : "POST",
        body: toPackagePayload(draft, { isNew: !pkg }),
      });
      if (!pkg) {
        notify(t("package.created"));
        guard.leave(`/packages/${result.id}`);
        return; // stay busy while the new package's page loads
      }
      applyPackage(result);
      notify(t("package.saved"));
    } catch (error) {
      if (isValidationError(error)) {
        const mapped = mapFieldErrors(error, (key) => PACKAGE_FIELDS.has(key.split(".")[0]));
        setErrors({ fields: packageFieldErrors(mapped.fields), form: mapped.form });
      } else {
        const failure = describePackageError(error, t);
        setErrors({ fields: {}, form: [failure.title ? `${failure.title}: ${failure.message}` : failure.message] });
      }
      requestAnimationFrame(() => summaryRef.current?.focus());
    }
    setBusy(false);
  }

  /** Confirmed actions: the dialog stays open until the server answers and shows any
   * failure itself (e.g. 409 in use). */
  async function runConfirmed(action: Confirm) {
    if (!pkg) return;
    if (action === "delete") {
      await apiFetch(`/admin/packages/${pkg.id}/`, { method: "DELETE" });
      notify(t("package.deleted"));
      guard.leave("/packages");
      return;
    }
    const status = action === "activate" ? "active" : "inactive";
    applyPackage(await apiFetch<Package>(`/admin/packages/${pkg.id}/`, { method: "PATCH", body: { status } }));
    setConfirm(null);
    notify(t(action === "activate" ? "package.activated" : "package.deactivated"));
  }

  const title = pkg ? packageName(pkg, locale) : null;
  const displayName = pkg ? title?.text || pkg.slug : "";
  const n = (value: number) => formatNumber(value, locale);
  const hasFieldErrors = Object.keys(fields).length > 0;

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <Link href="/packages" className="inline-flex items-center gap-1.5 rounded-control text-sm text-ink-muted hover:text-ink">
          <ArrowLeft className="size-4" aria-hidden />
          {t("package.back")}
        </Link>
        <header className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0 space-y-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <h1 lang={title?.lang} className="text-2xl font-semibold tracking-tight break-words text-ink">
                {pkg ? displayName || t("packages.untitled") : t("package.createTitle")}
              </h1>
              {pkg && <PackageStatusBadge status={pkg.status} />}
              {pkg?.is_featured && <FeaturedBadge />}
            </div>
            {pkg && (
              <>
                <p className="text-sm text-ink-muted">
                  <span className="tabular-nums">#{pkg.id}</span>
                  {" · "}
                  {t("package.facts", {
                    price: formatMoney(pkg.price, pkg.currency, locale),
                    validity: t("packages.days", { n: n(pkg.validity_days) }),
                    rules: pkg.rule_count ? t("packages.rulesCount", { n: n(pkg.rule_count) }) : t("packages.noRules"),
                    subscriptions: t("package.subscriptionsCount", { n: n(pkg.subscription_count) }),
                  })}
                </p>
                <p className="text-[13px] text-ink-subtle">
                  {t("package.createdAt", { time: formatDateTime(pkg.created_at, locale) })}
                  {" · "}
                  {t("package.updatedAt", { time: formatDateTime(pkg.updated_at, locale) })}
                </p>
              </>
            )}
          </div>
          {pkg && (
            <div className="min-w-0 lg:max-w-xl">
              <div role="group" aria-label={t("package.actions")} className="flex flex-wrap gap-2 lg:justify-end">
                {pkg.status === "active" ? (
                  <Button variant="secondary" onClick={() => setConfirm("deactivate")} disabled={busy || settingsDirty} aria-describedby={settingsDirty ? "package-save-first" : undefined}>
                    <PowerOff aria-hidden />
                    {t("package.deactivate")}
                  </Button>
                ) : (
                  <Button variant="secondary" onClick={() => setConfirm("activate")} disabled={busy || settingsDirty} aria-describedby={settingsDirty ? "package-save-first" : undefined}>
                    <Power aria-hidden />
                    {t("package.activate")}
                  </Button>
                )}
                {pkg.subscription_count === 0 && (
                  <Button variant="secondary" onClick={() => setConfirm("delete")} disabled={busy} className="text-danger-700 hover:bg-danger-50">
                    <Trash2 aria-hidden />
                    {t("common.delete")}
                  </Button>
                )}
              </div>
              {settingsDirty && (
                <p id="package-save-first" className="mt-2 text-[13px] text-ink-muted lg:text-right">
                  {t("package.saveFirst")}
                </p>
              )}
            </div>
          )}
        </header>
        {pkg && (
          <p className="text-sm">
            <Link
              href={`/payments?package=${pkg.id}`}
              className="rounded-control font-medium text-brand-700 underline underline-offset-2 hover:text-brand-600"
            >
              {t("package.viewPayments")}
            </Link>
          </p>
        )}
        {pkg && pkg.subscription_count > 0 && (
          <p className="flex flex-wrap items-start gap-x-3 gap-y-1 text-sm text-ink-muted">
            <span className="inline-flex items-start gap-1.5">
              <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
              {t("package.inUseNote")}
            </span>
            <Link
              href={`/subscriptions?package=${pkg.id}`}
              className="rounded-control font-medium text-brand-700 underline underline-offset-2 hover:text-brand-600"
            >
              {t("package.viewSubscriptions")}
            </Link>
          </p>
        )}
      </div>

      <div ref={summaryRef} tabIndex={-1} className="space-y-3 focus:outline-none">
        {(errors.form.length > 0 || hasFieldErrors) && (
          <Alert tone="danger" title={hasFieldErrors ? t("form.errorSummary") : undefined} live>
            {errors.form.length > 0 && (
              <ul className="list-disc space-y-0.5 pl-5 text-danger-700">
                {errors.form.map((message, index) => (
                  <li key={index}>{message}</li>
                ))}
              </ul>
            )}
          </Alert>
        )}
      </div>

      <form noValidate onSubmit={save} className="space-y-6">
        <FormSection title={t("package.sectionBasics")} description={t("package.sectionBasicsHint")}>
          <BilingualField
            id="package-name"
            label={t("package.nameLabel")}
            required
            maxLength={NAME_MAX_LENGTH}
            disabled={busy}
            values={{ bn: draft.name_bn, en: draft.name_en }}
            onChange={(lang, value) => set(lang === "bn" ? "name_bn" : "name_en", value)}
            errors={{ bn: fields.name_bn, en: fields.name_en }}
          />
          <Field id="package-slug" label={t("field.slug")} optional hint={t("field.slugHint")} error={fields.slug}>
            <Input
              value={draft.slug}
              maxLength={SLUG_MAX_LENGTH}
              onChange={(event) => set("slug", event.target.value)}
              disabled={busy}
              autoComplete="off"
              spellCheck={false}
            />
          </Field>
          <BilingualField
            id="package-description"
            label={t("package.descriptionLabel")}
            multiline
            maxLength={DESCRIPTION_MAX_LENGTH}
            disabled={busy}
            values={{ bn: draft.description_bn, en: draft.description_en }}
            onChange={(lang, value) => set(lang === "bn" ? "description_bn" : "description_en", value)}
            errors={{ bn: fields.description_bn, en: fields.description_en }}
          />
          <BilingualField
            id="package-features"
            label={t("package.featuresLabel")}
            hint={t("package.featuresHint")}
            multiline
            rows={4}
            disabled={busy}
            values={{ bn: draft.features_bn, en: draft.features_en }}
            onChange={(lang, value) => set(lang === "bn" ? "features_bn" : "features_en", value)}
            errors={{ bn: fields.features_bn, en: fields.features_en }}
          />
        </FormSection>

        <FormSection title={t("package.sectionPricing")}>
          <div className="grid gap-5 md:grid-cols-3">
            <Field id="package-price" label={t("package.priceLabel")} required hint={t("package.priceHint")} error={fields.price}>
              <Input value={draft.price} inputMode="decimal" onChange={(event) => set("price", event.target.value)} disabled={busy} />
            </Field>
            <Field id="package-currency" label={t("package.currencyLabel")} required error={fields.currency}>
              <Select value={draft.currency} onChange={(event) => set("currency", event.target.value as PackageDraft["currency"])} disabled={busy}>
                {CURRENCIES.map((value) => (
                  <option key={value} value={value}>
                    {t(`currency.${value}`)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field id="package-validity" label={t("package.validityLabel")} required hint={t("package.validityHint")} error={fields.validity_days}>
              <Input value={draft.validity_days} inputMode="numeric" onChange={(event) => set("validity_days", event.target.value)} disabled={busy} />
            </Field>
          </div>
        </FormSection>

        <FormSection title={t("package.sectionDisplay")}>
          <div className="grid gap-5 md:grid-cols-2">
            <Field id="package-sort" label={t("package.sortOrderLabel")} optional hint={t("package.sortOrderHint")} error={fields.sort_order}>
              <Input value={draft.sort_order} inputMode="numeric" onChange={(event) => set("sort_order", event.target.value)} disabled={busy} />
            </Field>
            {!pkg && (
              <Field id="package-status" label={t("package.statusLabel")} required hint={t("package.statusHint")} error={fields.status}>
                <Select value={draft.status} onChange={(event) => set("status", event.target.value as PackageDraft["status"])} disabled={busy}>
                  {PACKAGE_STATUSES.map((value) => (
                    <option key={value} value={value}>
                      {t(value === "active" ? "status.active" : "status.inactive")}
                    </option>
                  ))}
                </Select>
              </Field>
            )}
          </div>
          <Switch
            id="package-featured"
            label={t("package.featuredLabel")}
            hint={t("package.featuredHint")}
            checked={draft.is_featured}
            onChange={(checked) => set("is_featured", checked)}
            disabled={busy}
          />
        </FormSection>

        <div className="sticky bottom-0 z-10 -mx-4 flex flex-wrap items-center justify-end gap-2 border-t border-line bg-surface/95 px-4 py-3 backdrop-blur sm:mx-0 sm:rounded-card sm:border">
          {settingsDirty && (
            <span className="mr-auto inline-flex items-center gap-1.5 text-[13px] text-warning-700">
              <span className="size-2 rounded-full bg-accent-500" aria-hidden />
              {t("package.unsaved")}
            </span>
          )}
          <Button variant="secondary" onClick={() => guard.request("/packages")}>
            {t("common.cancel")}
          </Button>
          <Button type="submit" disabled={busy} aria-busy={busy || undefined}>
            {busy ? t("common.saving") : pkg ? t("package.save") : t("package.create")}
          </Button>
        </div>
      </form>

      {pkg ? (
        <AccessRulesEditor
          packageId={pkg.id}
          rules={rules}
          categories={categories}
          categoriesTruncated={lookupTruncated}
          disabled={busy}
          onDirtyChange={onRulesDirty}
          onSaved={(ruleCount) => setPkg((current) => (current ? { ...current, rule_count: ruleCount } : current))}
        />
      ) : (
        <FormSection title={t("rules.title")} description={t("rules.hint")}>
          <p className="text-sm text-ink-muted">{t("rules.saveFirst")}</p>
        </FormSection>
      )}

      {pkg && confirm && (
        <ConfirmDialog
          open
          onOpenChange={(open) => !open && setConfirm(null)}
          title={t(`package.${confirm}Title`)}
          description={confirm === "delete" ? t("package.deleteBody", { name: displayName }) : t(`package.${confirm}Body`)}
          confirmLabel={t(confirm === "delete" ? "common.delete" : `package.${confirm}`)}
          pendingLabel={confirm === "delete" ? t("common.deleting") : t("package.working")}
          confirmVariant={confirm === "activate" ? "primary" : "danger"}
          onConfirm={() => runConfirmed(confirm)}
          describe={(error) => describePackageError(error, t)}
        />
      )}

      <Modal
        open={guard.pending !== null}
        onOpenChange={(open) => !open && guard.cancel()}
        title={t("package.unsavedTitle")}
        description={t("package.unsavedBody")}
        size="sm"
        role="alertdialog"
        initialFocus={keepEditingRef}
        footer={
          <>
            <Button ref={keepEditingRef} variant="secondary" onClick={guard.cancel}>
              {t("package.keepEditing")}
            </Button>
            <Button variant="danger" onClick={guard.discard}>
              {guard.pending && "action" in guard.pending ? t("package.discardSignOut") : t("package.discard")}
            </Button>
          </>
        }
      />
    </div>
  );
}
