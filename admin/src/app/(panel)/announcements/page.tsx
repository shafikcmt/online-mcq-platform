import { AnnouncementsView } from "@/components/cms/announcements-view";
import { adminList } from "@/lib/api/lists";
import { ANNOUNCEMENT_LIST } from "@/lib/content-specs";
import { titleMetadata } from "@/lib/i18n/metadata";
import { parseListParams } from "@/lib/list-params";
import type { Announcement } from "@/types/cms";

export const generateMetadata = () => titleMetadata("announcements.title");

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function AnnouncementsPage({ searchParams }: { searchParams: SearchParams }) {
  const state = parseListParams(await searchParams, ANNOUNCEMENT_LIST);
  const data = await adminList<Announcement>("/admin/announcements/", state, ANNOUNCEMENT_LIST, "/announcements");
  return <AnnouncementsView data={data} state={state} />;
}
