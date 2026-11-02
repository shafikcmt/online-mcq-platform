"use client";

import { Package as PackageIcon, UserRound } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from "react";

import { packageName } from "@/components/packages/package-cells";
import { StudentPicker } from "@/components/results/student-picker";
import { MaskedValue } from "@/components/users/user-cells";
import { Button } from "@/components/ui/button";
import { Field, FormErrors, Input } from "@/components/ui/form";
import { Modal } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";
import { ApiError, describeError } from "@/lib/api/errors";
import { isValidationError, mapFieldErrors, type MappedErrors } from "@/lib/api/field-errors";
import { fromDhakaInput } from "@/lib/exam-form";
import { formatMoney } from "@/lib/format";
import { useI18n } from "@/lib/i18n/provider";
import { grantSubscription, newIdempotencyKey, type GrantInput } from "@/lib/subscription-actions";
import type { Package } from "@/types/packages";

import { PackagePicker } from "./package-picker";

export type GrantStudent = { id: number; full_name: string; mobile_display: string };
/** A package as the detail page knows it (price/status only when it came from the picker). */
export type GrantPackage = Pick<Package, "id" | "slug" | "name_bn" | "name_en"> &
  Partial<Pick<Package, "price" | "currency" | "validity_days" | "status">>;

const FIELDS = ["user", "package", "price_paid", "starts_at"];
const NO_ERRORS: MappedErrors = { fields: {}, form: [] };

/** Manual grant (or extension) of a package to a student, without a payment.
 *
 * Retry safety: one `Idempotency-Key` is created each time the dialog opens and is sent
 * with every submit of that dialog — a double click, a retry after a network error or a
 * timeout never grants twice (the server replays its first answer). Opening the dialog
 * again starts a new grant with a new key. `fixed`: student and package come from the
 * subscription being extended and cannot be changed (no start time: an extension always
 * continues from the current expiry). */
export function GrantDialog({
  open,
  onOpenChange,
  student: initialStudent = null,
  pkg: initialPackage = null,
  fixed = false,
  extending = false,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  student?: GrantStudent | null;
  pkg?: GrantPackage | null;
  fixed?: boolean;
  /** The subscription being extended is still running (no start time can be set). */
  extending?: boolean;
}) {
  const { locale, t } = useI18n();
  const router = useRouter();
  const { notify } = useToast();
  const formId = useId();
  const key = useRef("");
  const [student, setStudent] = useState<GrantStudent | null>(initialStudent);
  const [pkg, setPkg] = useState<GrantPackage | null>(initialPackage);
  const [price, setPrice] = useState("");
  const [start, setStart] = useState("");
  const [errors, setErrors] = useState<MappedErrors>(NO_ERRORS);
  const [pending, setPending] = useState(false);
  const [picking, setPicking] = useState<"student" | "package" | null>(null);

  // Each opening is a new intended grant: fresh form and a fresh key. Retries inside
  // this opening keep the key (initial values are read only at that moment on purpose).
  useEffect(() => {
    if (!open) return;
    key.current = newIdempotencyKey();
    setStudent(initialStudent);
    setPkg(initialPackage);
    setPrice("");
    setStart("");
    setErrors(NO_ERRORS);
    setPicking(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (pending) return;
    if (!student || !pkg) {
      setErrors({
        fields: {
          ...(student ? {} : { user: t("grant.studentRequired") }),
          ...(pkg ? {} : { package: t("grant.packageRequired") }),
        },
        form: [],
      });
      return;
    }
    setPending(true);
    setErrors(NO_ERRORS);
    const body: GrantInput = { user: student.id, package: pkg.id };
    if (price.trim()) body.price_paid = price.trim();
    const startsAt = extending ? null : fromDhakaInput(start);
    if (startsAt) body.starts_at = startsAt;
    try {
      const outcome = await grantSubscription(body, key.current);
      notify(t(outcome.replayed ? "grant.replayed" : outcome.extended ? "grant.extended" : "grant.granted"));
      onOpenChange(false);
      router.push(`/subscriptions/${outcome.subscription.id}`);
      router.refresh();
    } catch (error) {
      if (isValidationError(error)) {
        setErrors(mapFieldErrors(error, (field) => FIELDS.includes(field)));
      } else if (error instanceof ApiError && error.code === "idempotency_key_reused") {
        setErrors({ fields: {}, form: [t("grant.keyReused")] });
      } else if (error instanceof ApiError && error.isNetwork) {
        setErrors({ fields: {}, form: [`${describeError(error, t)} ${t("grant.retrySafe")}`] });
      } else {
        setErrors({ fields: {}, form: [describeError(error, t)] });
      }
    } finally {
      setPending(false);
    }
  }

  const pkgTitle = pkg ? packageName(pkg, locale) : null;
  const studentError = errors.fields.user;
  const packageError = errors.fields.package;

  return (
    <>
      <Modal
        open={open}
        onOpenChange={onOpenChange}
        title={t(fixed ? (extending ? "grant.extendTitle" : "grant.againTitle") : "grant.title")}
        description={t("grant.description")}
        size="md"
        closeDisabled={pending}
        footer={
          <>
            <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={pending}>
              {t("common.cancel")}
            </Button>
            <Button type="submit" form={formId} disabled={pending} aria-busy={pending || undefined}>
              {pending ? t("grant.submitting") : t(extending ? "grant.extendSubmit" : "grant.submit")}
            </Button>
          </>
        }
      >
        <form id={formId} noValidate onSubmit={submit} className="space-y-5">
          <FormErrors messages={errors.form} />

          <Choice
            id={`${formId}-student`}
            label={t("grant.student")}
            error={studentError}
            empty={t("grant.noStudent")}
            change={fixed ? null : { label: t(student ? "grant.change" : "grant.chooseStudent"), icon: <UserRound aria-hidden />, onClick: () => setPicking("student") }}
            disabled={pending}
          >
            {student && (
              <>
                <span className="block font-medium break-words text-ink">{student.full_name}</span>
                <span className="block text-xs text-ink-subtle">
                  <MaskedValue value={student.mobile_display} />
                </span>
              </>
            )}
          </Choice>

          <Choice
            id={`${formId}-package`}
            label={t("grant.package")}
            error={packageError ?? (pkg?.status === "inactive" ? t("grant.packageInactive") : undefined)}
            empty={t("grant.noPackage")}
            change={fixed ? null : { label: t(pkg ? "grant.change" : "grant.choosePackage"), icon: <PackageIcon aria-hidden />, onClick: () => setPicking("package") }}
            disabled={pending}
          >
            {pkg && pkgTitle && (
              <>
                <span lang={pkgTitle.lang} className="block font-medium break-words text-ink">
                  {pkgTitle.text || pkg.slug}
                </span>
                {pkg.price !== undefined && pkg.validity_days !== undefined && (
                  <span className="block text-xs text-ink-subtle tabular-nums">
                    {t("grant.packageTerms", { price: formatMoney(pkg.price, pkg.currency ?? "BDT", locale), days: pkg.validity_days })}
                  </span>
                )}
              </>
            )}
          </Choice>

          <Field id={`${formId}-price`} label={t("grant.price")} optional hint={t("grant.priceHint")} error={errors.fields.price_paid}>
            <Input
              inputMode="decimal"
              autoComplete="off"
              value={price}
              onChange={(event) => setPrice(event.target.value)}
              disabled={pending}
              lang="en"
            />
          </Field>

          {!extending && (
            <Field id={`${formId}-start`} label={t("grant.start")} optional hint={t("grant.startHint")} error={errors.fields.starts_at}>
              <Input type="datetime-local" value={start} onChange={(event) => setStart(event.target.value)} disabled={pending} />
            </Field>
          )}

          <p className="rounded-card border border-line bg-neutral-50/70 px-4 py-3 text-sm text-ink-muted">
            {t(extending ? "grant.extendNote" : "grant.note")}
          </p>
        </form>
      </Modal>

      <StudentPicker
        open={picking === "student"}
        onOpenChange={(next) => setPicking(next ? "student" : null)}
        selectText={t("grant.choose")}
        selectLabel={(name) => t("grant.chooseLabel", { name })}
        onSelect={(user) => {
          setPicking(null);
          setStudent({ id: user.id, full_name: user.full_name, mobile_display: user.mobile_display });
          setErrors((current) => ({ ...current, fields: { ...current.fields, user: "" } }));
        }}
      />
      <PackagePicker
        open={picking === "package"}
        onOpenChange={(next) => setPicking(next ? "package" : null)}
        selectText={t("grant.choose")}
        selectLabel={(name) => t("grant.chooseLabel", { name })}
        onSelect={(chosen) => {
          setPicking(null);
          setPkg(chosen);
          setErrors((current) => ({ ...current, fields: { ...current.fields, package: "" } }));
        }}
      />
    </>
  );
}

/** A chosen student/package shown as a card, with a button to choose another. */
function Choice({
  id,
  label,
  error,
  empty,
  change,
  disabled,
  children,
}: {
  id: string;
  label: string;
  error?: string;
  empty: string;
  change: { label: string; icon: ReactNode; onClick: () => void } | null;
  disabled: boolean;
  children: ReactNode;
}) {
  const hasValue = Boolean(children);
  return (
    <div role="group" aria-labelledby={`${id}-label`} aria-describedby={error ? `${id}-error` : undefined}>
      <p id={`${id}-label`} className="text-sm font-medium text-ink">
        {label}
      </p>
      <div
        className={`mt-1.5 flex flex-wrap items-center gap-3 rounded-control border px-3 py-2.5 ${error ? "border-danger-700" : "border-line-strong"}`}
      >
        <div className="min-w-0 flex-1 text-sm">{hasValue ? children : <span className="text-ink-subtle">{empty}</span>}</div>
        {change && (
          <Button variant="secondary" size="sm" onClick={change.onClick} disabled={disabled} aria-haspopup="dialog">
            {change.icon}
            {change.label}
          </Button>
        )}
      </div>
      {error && (
        <p id={`${id}-error`} className="mt-1.5 text-[13px] text-danger-700">
          {error}
        </p>
      )}
    </div>
  );
}
