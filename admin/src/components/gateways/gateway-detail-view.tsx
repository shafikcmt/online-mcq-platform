"use client";

import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { Alert } from "@/components/ui/alert";
import { Switch } from "@/components/ui/form";
import { PageHeader } from "@/components/ui/page-header";
import { StatusBadge } from "@/components/ui/status-badge";
import { useToast } from "@/components/ui/toast";
import { apiFetch } from "@/lib/api/client";
import { describeError } from "@/lib/api/errors";
import { gatewayName, issueText } from "@/lib/gateway-form";
import { useI18n } from "@/lib/i18n/provider";
import type { Adapter, Gateway, GatewayLogEntry } from "@/types/gateways";

import { GatewayCredentials } from "./gateway-credentials";
import { GatewayHistory } from "./gateway-history";
import { GatewayModePanel } from "./gateway-mode-panel";
import { ChannelBadges, ModeBadge, ReadyBadge } from "./gateway-parts";
import { GatewaySettingsForm } from "./gateway-settings-form";
import { GatewayTestPanel } from "./gateway-test-panel";

/** One merchant account: status and the on/off switch, then settings, credentials, mode,
 * connection test and history. Every change goes through the Phase 3 API; the page only
 * keeps the gateway the server last returned. */
export function GatewayDetailView({
  gateway: initial,
  adapter,
  logs: initialLogs,
}: {
  gateway: Gateway;
  adapter: Adapter | undefined;
  logs: GatewayLogEntry[];
}) {
  const { t, locale } = useI18n();
  const { notify } = useToast();
  const [gateway, setGateway] = useState(initial);
  const [logs, setLogs] = useState(initialLogs);
  const [switching, setSwitching] = useState(false);
  const [refusal, setRefusal] = useState<string[]>([]);

  /** Any change may have written a log entry: refresh the history from the server. */
  async function update(next: Gateway) {
    setGateway(next);
    try {
      const fresh = await apiFetch<{ results: GatewayLogEntry[] }>(`/admin/payment-gateways/${next.id}/logs/`);
      setLogs(fresh.results);
    } catch {
      // the history is informational; the change itself already succeeded
    }
  }

  async function toggle(enabled: boolean) {
    if (switching) return;
    setSwitching(true);
    setRefusal([]);
    try {
      const next = await apiFetch<Gateway>(`/admin/payment-gateways/${gateway.id}/${enabled ? "enable" : "disable"}/`, { method: "POST" });
      await update(next);
      notify(t(enabled ? "gw.enabledToast" : "gw.disabledToast", { name: gatewayName(next, locale) }));
    } catch (failure) {
      setRefusal([describeError(failure, t), ...gateway.issues.map((code) => issueText(code, adapter, locale, t))]);
    } finally {
      setSwitching(false);
    }
  }

  return (
    <div className="space-y-6">
      <Link href="/payment-gateways" className="inline-flex items-center gap-1.5 text-sm text-ink-muted hover:text-ink">
        <ArrowLeft className="size-4" aria-hidden />
        {t("gw.back")}
      </Link>
      <PageHeader
        title={gatewayName(gateway, locale)}
        subtitle={`${adapter ? (locale === "bn" ? adapter.label_bn : adapter.label_en) : gateway.adapter_label} · ${gateway.slug}`}
      />

      <section aria-labelledby="gw-status" className="space-y-4 rounded-card border border-line bg-surface p-5">
        <h2 id="gw-status" className="sr-only">
          {t("gw.secStatus")}
        </h2>
        <div className="flex flex-wrap items-center gap-2">
          <ModeBadge mode={gateway.mode} />
          <ReadyBadge gateway={gateway} />
          <StatusBadge status={gateway.enabled ? "active" : "inactive"} label={t(gateway.enabled ? "gw.statusEnabled" : "gw.statusDisabled")} />
          <ChannelBadges gateway={gateway} />
        </div>
        <Switch
          id="gw-enabled"
          label={t("gw.offer")}
          hint={t("gw.offerHint")}
          checked={gateway.enabled}
          disabled={switching || !gateway.implemented}
          onChange={toggle}
        />
        {gateway.issues.length ? (
          <Alert tone="warning" title={t("gw.statusIssues")}>
            <ul className="list-disc space-y-0.5 pl-5">
              {gateway.issues.map((code) => (
                <li key={code}>{issueText(code, adapter, locale, t)}</li>
              ))}
            </ul>
          </Alert>
        ) : (
          <Alert tone="info">{t("gw.statusReady")}</Alert>
        )}
        {gateway.mode === "sandbox" ? <p className="text-sm text-ink-muted">{t("gw.testersOnly")}</p> : null}
        {refusal.length ? (
          <Alert tone="danger" live>
            {refusal[0]}
          </Alert>
        ) : null}
      </section>

      <GatewaySettingsForm gateway={gateway} adapter={adapter} onSaved={update} />
      <GatewayCredentials gateway={gateway} adapter={adapter} onSaved={update} />
      <GatewayModePanel gateway={gateway} adapter={adapter} onChanged={update} />
      <GatewayTestPanel gateway={gateway} adapter={adapter} onTested={update} />
      <GatewayHistory entries={logs} />
    </div>
  );
}
