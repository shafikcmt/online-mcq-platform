import { GatewayListView } from "@/components/gateways/gateway-list-view";
import { adminRead } from "@/lib/api/server";
import { titleMetadata } from "@/lib/i18n/metadata";
import type { Adapter, Gateway, GatewayStats } from "@/types/gateways";

export const generateMetadata = () => titleMetadata("gw.title");

export default async function PaymentGatewaysPage() {
  const [gateways, adapters, stats] = await Promise.all([
    adminRead<{ results: Gateway[] }>("/admin/payment-gateways/"),
    adminRead<{ results: Adapter[] }>("/admin/payment-gateways/adapters/"),
    adminRead<GatewayStats>("/admin/payment-gateways/stats/"),
  ]);
  return <GatewayListView gateways={gateways.results} adapters={adapters.results} stats={stats} />;
}
