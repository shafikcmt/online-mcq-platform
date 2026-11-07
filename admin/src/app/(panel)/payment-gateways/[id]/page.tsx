import { notFound } from "next/navigation";

import { GatewayDetailView } from "@/components/gateways/gateway-detail-view";
import { ApiError, adminRead } from "@/lib/api/server";
import { titleMetadata } from "@/lib/i18n/metadata";
import type { Adapter, Gateway, GatewayLogEntry } from "@/types/gateways";

export const generateMetadata = () => titleMetadata("gw.title");

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function PaymentGatewayPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  try {
    const [gateway, adapters, logs] = await Promise.all([
      adminRead<Gateway>(`/admin/payment-gateways/${id}/`),
      adminRead<{ results: Adapter[] }>("/admin/payment-gateways/adapters/"),
      adminRead<{ results: GatewayLogEntry[] }>(`/admin/payment-gateways/${id}/logs/`),
    ]);
    return <GatewayDetailView gateway={gateway} adapter={adapters.results.find((item) => item.code === gateway.adapter)} logs={logs.results} />;
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) notFound();
    throw error;
  }
}
