import { CategoriesView } from "@/components/content/categories-view";
import { adminList } from "@/lib/api/lists";
import { CATEGORY_LIST } from "@/lib/content-specs";
import { titleMetadata } from "@/lib/i18n/metadata";
import { parseListParams } from "@/lib/list-params";
import type { Category } from "@/types/content";

export const generateMetadata = () => titleMetadata("categories.title");

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function CategoriesPage({ searchParams }: { searchParams: SearchParams }) {
  const state = parseListParams(await searchParams, CATEGORY_LIST);
  const data = await adminList<Category>("/admin/categories/", state, CATEGORY_LIST, "/categories");
  return <CategoriesView data={data} state={state} />;
}
