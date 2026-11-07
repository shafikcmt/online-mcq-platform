import { TestingView } from "@/components/gateways/testing-view";
import { adminRead } from "@/lib/api/server";
import { titleMetadata } from "@/lib/i18n/metadata";
import type { Paginated } from "@/types/content";
import type { Tester } from "@/types/gateways";
import type { AdminSubscription } from "@/types/subscriptions";

export const generateMetadata = () => titleMetadata("gwt.title");

export default async function GatewayTestingPage() {
  const [testers, subscriptions] = await Promise.all([
    adminRead<{ results: Tester[] }>("/admin/payment-testers/"),
    adminRead<Paginated<AdminSubscription>>("/admin/subscriptions/?is_test=true&page_size=100"),
  ]);
  return <TestingView testers={testers.results} subscriptions={subscriptions.results} />;
}
