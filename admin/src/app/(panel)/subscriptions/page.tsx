import { SubscriptionsView } from "@/components/subscriptions/subscriptions-view";
import { adminList } from "@/lib/api/lists";
import { readPackageOrNull } from "@/lib/api/package-page";
import { readUserOrNull } from "@/lib/api/user-page";
import { SUBSCRIPTION_LIST } from "@/lib/content-specs";
import { titleMetadata } from "@/lib/i18n/metadata";
import { parseListParams } from "@/lib/list-params";
import type { AdminSubscription } from "@/types/subscriptions";

export const generateMetadata = () => titleMetadata("subscriptions.title");

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function SubscriptionsPage({ searchParams }: { searchParams: SearchParams }) {
  const state = parseListParams(await searchParams, SUBSCRIPTION_LIST);
  const userId = state.filters.user ? Number(state.filters.user) : null;
  const packageId = state.filters.package ? Number(state.filters.package) : null;
  // One page of subscriptions (student and package names come with each row) and, when
  // filtered, that student and that package for the chips — in parallel.
  const [data, user, pkg] = await Promise.all([
    adminList<AdminSubscription>("/admin/subscriptions/", state, SUBSCRIPTION_LIST, "/subscriptions"),
    userId ? readUserOrNull(userId) : Promise.resolve(null),
    packageId ? readPackageOrNull(packageId) : Promise.resolve(null),
  ]);
  const student = userId ? { id: userId, user: user && { id: user.id, full_name: user.full_name } } : null;
  return <SubscriptionsView data={data} state={state} student={student} pkg={packageId ? { id: packageId, pkg } : null} />;
}
