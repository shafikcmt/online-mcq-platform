import { UsersView } from "@/components/users/users-view";
import { adminList } from "@/lib/api/lists";
import { USER_LIST } from "@/lib/content-specs";
import { titleMetadata } from "@/lib/i18n/metadata";
import { parseListParams } from "@/lib/list-params";
import type { AdminUser } from "@/types/users";

export const generateMetadata = () => titleMetadata("users.title");

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function UsersPage({ searchParams }: { searchParams: SearchParams }) {
  const state = parseListParams(await searchParams, USER_LIST);
  const data = await adminList<AdminUser>("/admin/users/", state, USER_LIST, "/users");
  return <UsersView data={data} state={state} />;
}
