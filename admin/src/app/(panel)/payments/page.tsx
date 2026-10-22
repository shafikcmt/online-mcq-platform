import { PaymentsView } from "@/components/payments/payments-view";
import { adminList } from "@/lib/api/lists";
import { readPackageOrNull } from "@/lib/api/package-page";
import { readSubscriptionOrNull } from "@/lib/api/subscription-page";
import { readUserOrNull } from "@/lib/api/user-page";
import { PAYMENT_LIST } from "@/lib/content-specs";
import { titleMetadata } from "@/lib/i18n/metadata";
import { parseListParams } from "@/lib/list-params";
import type { AdminPayment } from "@/types/payments";

export const generateMetadata = () => titleMetadata("payments.title");

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function PaymentsPage({ searchParams }: { searchParams: SearchParams }) {
  const state = parseListParams(await searchParams, PAYMENT_LIST);
  const userId = state.filters.user ? Number(state.filters.user) : null;
  const packageId = state.filters.package ? Number(state.filters.package) : null;
  const subscriptionId = state.filters.subscription ? Number(state.filters.subscription) : null;
  // One page of payments (student and package names come with each row) and, when
  // filtered, that student, package and subscription for the chips — in parallel. Never
  // a catalogue download.
  const [data, user, pkg, subscription] = await Promise.all([
    adminList<AdminPayment>("/admin/payments/", state, PAYMENT_LIST, "/payments"),
    userId ? readUserOrNull(userId) : Promise.resolve(null),
    packageId ? readPackageOrNull(packageId) : Promise.resolve(null),
    subscriptionId ? readSubscriptionOrNull(subscriptionId) : Promise.resolve(null),
  ]);
  const student = userId ? { id: userId, user: user && { id: user.id, full_name: user.full_name } } : null;
  return (
    <PaymentsView
      data={data}
      state={state}
      student={student}
      pkg={packageId ? { id: packageId, pkg } : null}
      subscription={subscriptionId ? { id: subscriptionId, subscription } : null}
    />
  );
}
