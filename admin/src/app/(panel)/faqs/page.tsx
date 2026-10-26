import { FaqsView } from "@/components/cms/faqs-view";
import { adminList } from "@/lib/api/lists";
import { FAQ_LIST } from "@/lib/content-specs";
import { titleMetadata } from "@/lib/i18n/metadata";
import { parseListParams } from "@/lib/list-params";
import type { Faq } from "@/types/cms";

export const generateMetadata = () => titleMetadata("faqs.title");

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function FaqsPage({ searchParams }: { searchParams: SearchParams }) {
  const state = parseListParams(await searchParams, FAQ_LIST);
  const data = await adminList<Faq>("/admin/faqs/", state, FAQ_LIST, "/faqs");
  return <FaqsView data={data} state={state} />;
}
