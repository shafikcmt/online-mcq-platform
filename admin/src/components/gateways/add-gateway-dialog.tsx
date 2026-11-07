"use client";

import { useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { Field, FormErrors, Input, Select } from "@/components/ui/form";
import { Modal } from "@/components/ui/modal";
import { apiFetch } from "@/lib/api/client";
import { ApiError, describeError } from "@/lib/api/errors";
import { adapterLabel } from "@/lib/gateway-form";
import { useI18n } from "@/lib/i18n/provider";
import type { Adapter, Gateway } from "@/types/gateways";

const SLUG = /^[a-z][a-z0-9-]{1,39}$/;

/** Adds one merchant account on an implemented provider. A provider with no verified
 * adapter is shown but cannot be chosen. The same provider can be added more than once. */
export function AddGatewayDialog({
  open,
  onOpenChange,
  adapters,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  adapters: Adapter[];
  onCreated: (gateway: Gateway) => void;
}) {
  const { t, locale } = useI18n();
  const [adapter, setAdapter] = useState("");
  const [slug, setSlug] = useState("");
  const [name, setName] = useState("");
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [formError, setFormError] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  function change(next: boolean) {
    if (!next) {
      setAdapter("");
      setSlug("");
      setName("");
      setErrors({});
      setFormError([]);
    }
    onOpenChange(next);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    const local: Record<string, string[]> = {};
    if (!adapter) local.adapter = [t("gw.adapterPick")];
    if (!SLUG.test(slug)) local.slug = [t("gw.slugHint")];
    setErrors(local);
    if (Object.keys(local).length) return;
    setBusy(true);
    setFormError([]);
    try {
      const body: Record<string, unknown> = { adapter, slug };
      if (name.trim()) body.name_en = name.trim();
      const created = await apiFetch<Gateway>("/admin/payment-gateways/", { method: "POST", body });
      onCreated(created);
      change(false);
    } catch (failure) {
      if (failure instanceof ApiError && Object.keys(failure.fieldErrors).length) setErrors(failure.fieldErrors);
      else setFormError([describeError(failure, t)]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      onOpenChange={change}
      title={t("gw.addTitle")}
      description={t("gw.addHint")}
      closeDisabled={busy}
      footer={
        <>
          <Button type="button" variant="secondary" onClick={() => change(false)} disabled={busy}>
            {t("common.cancel")}
          </Button>
          <Button type="submit" form="add-gateway-form" disabled={busy}>
            {t("gw.create")}
          </Button>
        </>
      }
    >
      <form id="add-gateway-form" onSubmit={submit} className="space-y-4" noValidate>
        <FormErrors messages={formError} />
        <Field id="add-gw-adapter" label={t("gw.adapter")} error={errors.adapter?.[0]} required>
          <Select id="add-gw-adapter" value={adapter} onChange={(event) => setAdapter(event.target.value)}>
            <option value="">{t("gw.adapterPick")}</option>
            {adapters.map((item) => (
              <option key={item.code} value={item.code} disabled={!item.implemented}>
                {item.implemented
                  ? adapterLabel(item, item.code, locale)
                  : t("gw.adapterNotImplemented", { name: adapterLabel(item, item.code, locale) })}
              </option>
            ))}
          </Select>
        </Field>
        <Field id="add-gw-slug" label={t("gw.slug")} hint={t("gw.slugHint")} error={errors.slug?.[0]} required>
          <Input id="add-gw-slug" value={slug} maxLength={40} autoCapitalize="none" spellCheck={false} onChange={(event) => setSlug(event.target.value.toLowerCase())} />
        </Field>
        <Field id="add-gw-name" label={t("gw.name")} error={errors.name_en?.[0]} optional>
          <Input id="add-gw-name" value={name} maxLength={120} onChange={(event) => setName(event.target.value)} />
        </Field>
      </form>
    </Modal>
  );
}
