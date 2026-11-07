"use client";

import { useState } from "react";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { DateTimeText } from "@/components/ui/date-time";
import { FormSection } from "@/components/ui/form";
import { apiFetch } from "@/lib/api/client";
import { describeError } from "@/lib/api/errors";
import { testMessage } from "@/lib/gateway-form";
import { useI18n } from "@/lib/i18n/provider";
import type { Adapter, ConnectionResult, Gateway } from "@/types/gateways";

import { HealthBadge } from "./gateway-parts";

/** Checks the saved credentials with the provider (no payment is started) and shows the
 * gateway's health: last result, last successful connection. A provider without a safe
 * check says so; it is never shown as passed. */
export function GatewayTestPanel({
  gateway,
  adapter,
  onTested,
}: {
  gateway: Gateway;
  adapter: Adapter | undefined;
  onTested: (gateway: Gateway) => void;
}) {
  const { t, locale } = useI18n();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ConnectionResult | null>(null);
  const [error, setError] = useState("");

  async function run() {
    if (busy) return;
    setBusy(true);
    setError("");
    setResult(null);
    try {
      const answer = await apiFetch<{ result: ConnectionResult; gateway: Gateway }>(`/admin/payment-gateways/${gateway.id}/test/`, { method: "POST" });
      setResult(answer.result);
      onTested(answer.gateway);
    } catch (failure) {
      setError(describeError(failure, t));
    } finally {
      setBusy(false);
    }
  }

  const detail = result ? testMessage(result.message, adapter, locale, t) : "";
  return (
    <FormSection title={t("gw.secTest")} description={t("gw.testNote")} aside={<HealthBadge health={gateway.health.status} />}>
      <dl className="grid gap-3 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-ink-muted">{t("gw.lastTest")}</dt>
          <dd>{gateway.health.last_test_at ? <DateTimeText iso={gateway.health.last_test_at} /> : t("gw.never")}</dd>
        </div>
        <div>
          <dt className="text-ink-muted">{t("gw.lastConnected")}</dt>
          <dd>{gateway.health.last_connected_at ? <DateTimeText iso={gateway.health.last_connected_at} /> : t("gw.never")}</dd>
        </div>
      </dl>
      <div>
        <Button type="button" variant="secondary" disabled={busy || !gateway.implemented} onClick={run}>
          {busy ? t("gw.testRunning") : t("gw.testRun")}
        </Button>
      </div>
      <div aria-live="polite">
        {error ? <Alert tone="danger">{error}</Alert> : null}
        {result && !result.supported ? <Alert tone="info">{t("gw.testUnsupported")}</Alert> : null}
        {result && result.supported && result.ok ? <Alert tone="info">{[t("gw.testOk"), detail].filter(Boolean).join(" ")}</Alert> : null}
        {result && result.supported && !result.ok ? <Alert tone="danger">{t("gw.testFail", { reason: detail })}</Alert> : null}
      </div>
    </FormSection>
  );
}
