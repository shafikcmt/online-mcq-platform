import { GroupsView } from "@/components/content/groups-view";
import { adminList, adminLookup } from "@/lib/api/lists";
import { GROUP_LIST } from "@/lib/content-specs";
import { titleMetadata } from "@/lib/i18n/metadata";
import { parseListParams } from "@/lib/list-params";
import type { Category, ExamGroup } from "@/types/content";

export const generateMetadata = () => titleMetadata("groups.title");

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function GroupsPage({ searchParams }: { searchParams: SearchParams }) {
  const state = parseListParams(await searchParams, GROUP_LIST);
  // Independent reads, fetched in parallel: one page of groups, the category names and every
  // group (a sub-group's parent name, and the parent menu of the form).
  const [data, categories, everyGroup] = await Promise.all([
    adminList<ExamGroup>("/admin/groups/", state, GROUP_LIST, "/groups"),
    adminLookup<Category>("/admin/categories/"),
    adminLookup<ExamGroup>("/admin/groups/"),
  ]);
  return (
    <GroupsView
      data={data}
      state={state}
      categories={categories.rows}
      groups={everyGroup.rows}
      lookupTruncated={categories.truncated || everyGroup.truncated}
    />
  );
}
