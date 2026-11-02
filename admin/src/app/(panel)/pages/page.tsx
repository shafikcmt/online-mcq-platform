import { PagesView } from "@/components/cms/pages-view";
import { adminList } from "@/lib/api/lists";
import { PAGE_LIST } from "@/lib/content-specs";
import { titleMetadata } from "@/lib/i18n/metadata";
import { parseListParams } from "@/lib/list-params";
import type { CmsPage } from "@/types/cms";

export const generateMetadata = () => titleMetadata("pages.title");

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function PagesPage({ searchParams }: { searchParams: SearchParams }) {
  const state = parseListParams(await searchParams, PAGE_LIST);
  const data = await adminList<CmsPage>("/admin/pages/", state, PAGE_LIST, "/pages");
  return <PagesView data={data} state={state} />;
}
