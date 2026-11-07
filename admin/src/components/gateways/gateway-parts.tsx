"use client";

import { Globe, Smartphone } from "lucide-react";

import { Field, Input, Select, Switch } from "@/components/ui/form";
import { StatusBadge } from "@/components/ui/status-badge";
import { fieldLabel } from "@/lib/gateway-form";
import { useI18n } from "@/lib/i18n/provider";
import type { MessageKey } from "@/lib/i18n/messages";
import type { FieldSpec, Gateway } from "@/types/gateways";

export function ModeBadge({ mode }: { mode: Gateway["mode"] }) {
  const { t } = useI18n();
  return <StatusBadge status={mode} label={t(`gw.mode.${mode}` as MessageKey)} />;
}

export function HealthBadge({ health }: { health: Gateway["health"]["status"] }) {
  const { t } = useI18n();
  const status = health === "ok" ? "connected" : health;
  return <StatusBadge status={status} label={t(`gw.health.${health}` as MessageKey)} />;
}

export function ReadyBadge({ gateway }: { gateway: Pick<Gateway, "issues" | "implemented"> }) {
  const { t } = useI18n();
  if (!gateway.implemented) return <StatusBadge status="not_implemented" label={t("gw.notImplemented")} />;
  return gateway.issues.length ? (
    <StatusBadge status="not_ready" label={t("gw.notReady")} />
  ) : (
    <StatusBadge status="ready" label={t("gw.ready")} />
  );
}

/** Where the gateway is offered: website, app, both or (a warning) nowhere. */
export function ChannelBadges({ gateway }: { gateway: Pick<Gateway, "web_enabled" | "app_enabled"> }) {
  const { t } = useI18n();
  if (!gateway.web_enabled && !gateway.app_enabled) return <span className="text-xs text-ink-subtle">{t("gw.channelsOff")}</span>;
  const chip = "inline-flex items-center gap-1 rounded-full bg-surface-sunken px-2 py-0.5 text-xs text-ink-muted ring-1 ring-inset ring-line";
  return (
    <span className="inline-flex flex-wrap gap-1.5">
      {gateway.web_enabled && (
        <span className={chip}>
          <Globe className="size-3" aria-hidden />
          {t("gw.channel.web")}
        </span>
      )}
      {gateway.app_enabled && (
        <span className={chip}>
          <Smartphone className="size-3" aria-hidden />
          {t("gw.channel.app")}
        </span>
      )}
    </span>
  );
}

/** One adapter option, rendered from the provider's schema (text, url, integer, boolean,
 * select). The schema decides the control, so a new provider needs no UI change. */
export function SchemaField({
  idPrefix,
  field,
  value,
  error,
  onChange,
}: {
  idPrefix: string;
  field: FieldSpec;
  value: string | boolean;
  error?: string;
  onChange: (value: string | boolean) => void;
}) {
  const { t, locale } = useI18n();
  const id = `${idPrefix}-${field.name}`;
  const label = fieldLabel(field, locale);
  if (field.kind === "boolean") {
    return <Switch id={id} label={label} checked={Boolean(value)} onChange={onChange} />;
  }
  if (field.kind === "select") {
    return (
      <Field id={id} label={label} error={error} required={field.required}>
        <Select id={id} value={String(value)} onChange={(event) => onChange(event.target.value)}>
          <option value="">{t("gw.optionSelect")}</option>
          {field.choices.map((choice) => (
            <option key={choice} value={choice}>
              {choice}
            </option>
          ))}
        </Select>
      </Field>
    );
  }
  const hint =
    field.minimum !== null && field.maximum !== null ? `${field.minimum}–${field.maximum}` : undefined;
  return (
    <Field id={id} label={label} error={error} hint={hint} required={field.required}>
      <Input
        id={id}
        type={field.kind === "url" ? "url" : "text"}
        inputMode={field.kind === "integer" ? "numeric" : undefined}
        value={String(value)}
        onChange={(event) => onChange(event.target.value)}
      />
    </Field>
  );
}
