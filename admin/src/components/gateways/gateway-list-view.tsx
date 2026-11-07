"use client";

import { Plus, TestTube2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Alert } from "@/components/ui/alert";
import { Button, buttonVariants } from "@/components/ui/button";
import { Switch } from "@/components/ui/form";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/states";
import { useToast } from "@/components/ui/toast";
import { apiFetch } from "@/lib/api/client";
import { describeError } from "@/lib/api/errors";
import { formatMoney, formatNumber } from "@/lib/format";
import { adapterLabel, gatewayName, issueText } from "@/lib/gateway-form";
import { useI18n } from "@/lib/i18n/provider";
import { cn } from "@/lib/utils";
import type { Adapter, Gateway, GatewayStats, StatBlock } from "@/types/gateways";

import { AddGatewayDialog } from "./add-gateway-dialog";
import { ChannelBadges, HealthBadge, ModeBadge, ReadyBadge } from "./gateway-parts";

function StatCard({ title, note, block, tone }: { title: string; note?: string; block: StatBlock; tone: "real" | "test" }) {
  const { t, locale } = useI18n();
  const cells: [string, string][] = [
    [t("gw.collected"), formatMoney(block.collected, "BDT", locale)],
    [t("gw.successful"), formatNumber(block.success, locale)],
    [t("gw.failed"), formatNumber(block.failed, locale)],
    [t("gw.pending"), formatNumber(block.pending, locale)],
    [t("gw.total"), formatNumber(block.total, locale)],
  ];
  return (
    <section
      aria-label={title}
      className={cn("rounded-card border bg-surface p-4", tone === "test" ? "border-dashed border-line-strong" : "border-line")}
    >
      <h2 className="text-sm font-semibold text-ink">{title}</h2>
      {note ? <p className="mt-0.5 text-[13px] text-ink-muted">{note}</p> : null}
      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-5">
        {cells.map(([label, value]) => (
          <div key={label}>
            <dt className="text-xs text-ink-muted">{label}</dt>
            <dd className="text-sm font-medium tabular-nums text-ink">{value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

/** All gateways with their on/off switches, health and statistics. Turning one on is
 * refused by the server until it is ready; the reasons are listed on the card. */
export function GatewayListView({
  gateways: initial,
  adapters,
  stats,
}: {
  gateways: Gateway[];
  adapters: Adapter[];
  stats: GatewayStats;
}) {
  const { t, locale } = useI18n();
  const { notify } = useToast();
  const router = useRouter();
  const [gateways, setGateways] = useState(initial);
  const [adding, setAdding] = useState(false);
  const [busyId, setBusyId] = useState("");
  const [refusal, setRefusal] = useState<{ id: string; lines: string[] } | null>(null);

  const adapterOf = (code: string) => adapters.find((item) => item.code === code);
  const missing = adapters.filter((item) => !item.implemented);
  const statsOf = (id: string) => stats.gateways.find((row) => row.id === id);

  async function toggle(gateway: Gateway, enabled: boolean) {
    if (busyId) return;
    setBusyId(gateway.id);
    setRefusal(null);
    try {
      const next = await apiFetch<Gateway>(`/admin/payment-gateways/${gateway.id}/${enabled ? "enable" : "disable"}/`, { method: "POST" });
      setGateways((rows) => rows.map((row) => (row.id === next.id ? next : row)));
      notify(t(enabled ? "gw.enabledToast" : "gw.disabledToast", { name: gatewayName(next, locale) }));
    } catch (failure) {
      setRefusal({
        id: gateway.id,
        lines: [describeError(failure, t), ...gateway.issues.map((code) => issueText(code, adapterOf(gateway.adapter), locale, t))],
      });
    } finally {
      setBusyId("");
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("gw.title")}
        subtitle={t("gw.subtitle")}
        actions={
          <>
            <Link href="/payment-gateways/testing" className={buttonVariants({ variant: "secondary" })}>
              <TestTube2 aria-hidden />
              {t("gw.testingLink")}
            </Link>
            <Button onClick={() => setAdding(true)} aria-haspopup="dialog">
              <Plus aria-hidden />
              {t("gw.add")}
            </Button>
          </>
        }
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <StatCard title={t("gw.statsReal")} block={stats.real} tone="real" />
        <StatCard title={t("gw.statsSandbox")} note={t("gw.statsSandboxNote")} block={stats.sandbox} tone="test" />
      </div>

      {gateways.length === 0 ? (
        <EmptyState title={t("gw.empty")} description={t("gw.emptyHint")} action={<Button onClick={() => setAdding(true)}>{t("gw.add")}</Button>} />
      ) : (
        <ul className="space-y-4" aria-label={t("gw.title")}>
          {gateways.map((gateway) => {
            const adapter = adapterOf(gateway.adapter);
            const own = statsOf(gateway.id);
            return (
              <li key={gateway.id} className="space-y-3 rounded-card border border-line bg-surface p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h2 className="text-base font-semibold text-ink">
                      <Link href={`/payment-gateways/${gateway.id}`} className="hover:underline">
                        {gatewayName(gateway, locale)}
                      </Link>
                    </h2>
                    <p className="text-[13px] text-ink-muted">
                      {adapterLabel(adapter, gateway.adapter_label, locale)} · {gateway.slug} · {t("gw.priority", { n: gateway.priority })}
                    </p>
                  </div>
                  <Switch
                    id={`gw-switch-${gateway.id}`}
                    label={t("gw.offer")}
                    checked={gateway.enabled}
                    disabled={busyId === gateway.id || !gateway.implemented}
                    onChange={(on) => toggle(gateway, on)}
                  />
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <ModeBadge mode={gateway.mode} />
                  <ReadyBadge gateway={gateway} />
                  <HealthBadge health={gateway.health.status} />
                  <ChannelBadges gateway={gateway} />
                </div>
                {own ? (
                  <p className="text-[13px] text-ink-muted">
                    {t("gw.statsLive")}: {formatMoney(own.live.collected, "BDT", locale)} · {formatNumber(own.live.success, locale)}/{formatNumber(own.live.total, locale)}
                    {" · "}
                    {t("gw.statsTest")}: {formatNumber(own.sandbox.success, locale)}/{formatNumber(own.sandbox.total, locale)}
                  </p>
                ) : null}
                {refusal?.id === gateway.id ? (
                  <Alert tone="warning" live title={t("gw.enableRefused", { name: gatewayName(gateway, locale) })}>
                    <ul className="list-disc space-y-0.5 pl-5">
                      {refusal.lines.map((line, index) => (
                        <li key={index}>{line}</li>
                      ))}
                    </ul>
                  </Alert>
                ) : null}
                <div>
                  <Link href={`/payment-gateways/${gateway.id}`} className={buttonVariants({ variant: "secondary", size: "sm" })}>
                    {t("gw.open")}
                  </Link>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {missing.length ? (
        <Alert tone="info" title={t("gw.unimplementedTitle")}>
          <p>{t("gw.unimplementedText")}</p>
          <p className="mt-1 font-medium">{missing.map((item) => adapterLabel(item, item.code, locale)).join(", ")}</p>
        </Alert>
      ) : null}
      <p className="text-[13px] text-ink-muted">{t("gw.envNote")}</p>

      <AddGatewayDialog
        open={adding}
        onOpenChange={setAdding}
        adapters={adapters}
        onCreated={(created) => {
          setGateways((rows) => [...rows, created].sort((a, b) => a.priority - b.priority));
          notify(t("gw.created"));
          router.push(`/payment-gateways/${created.id}`);
        }}
      />
    </div>
  );
}
