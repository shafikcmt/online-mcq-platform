import { PackagesView } from "@/components/packages/packages-view";
import { adminList } from "@/lib/api/lists";
import { PACKAGE_LIST } from "@/lib/content-specs";
import { titleMetadata } from "@/lib/i18n/metadata";
import { parseListParams } from "@/lib/list-params";
import type { Package } from "@/types/packages";

export const generateMetadata = () => titleMetadata("packages.title");

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function PackagesPage({ searchParams }: { searchParams: SearchParams }) {
  const state = parseListParams(await searchParams, PACKAGE_LIST);
  const data = await adminList<Package>("/admin/packages/", state, PACKAGE_LIST, "/packages");
  return <PackagesView data={data} state={state} />;
}
