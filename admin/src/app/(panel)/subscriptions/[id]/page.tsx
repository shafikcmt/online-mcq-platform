import { SubscriptionDetail } from "@/components/subscriptions/subscription-detail";
import { readSubscription } from "@/lib/api/subscription-page";
import { titleMetadata } from "@/lib/i18n/metadata";

type Params = Promise<{ id: string }>;

export const generateMetadata = () => titleMetadata("subscriptionDetail.title");

export default async function SubscriptionPage({ params }: { params: Params }) {
  const subscription = await readSubscription((await params).id);
  return <SubscriptionDetail subscription={subscription} />;
}
