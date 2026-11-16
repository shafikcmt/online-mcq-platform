import { AnnouncementsView } from "@/components/cms/announcements-view";
import type { NoticeExamOption } from "@/components/cms/cms-form-dialog";
import { adminList, adminLookup } from "@/lib/api/lists";
import { ANNOUNCEMENT_LIST } from "@/lib/content-specs";
import { titleMetadata } from "@/lib/i18n/metadata";
import { parseListParams } from "@/lib/list-params";
import type { Announcement } from "@/types/cms";

export const generateMetadata = () => titleMetadata("announcements.title");

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function AnnouncementsPage({ searchParams }: { searchParams: SearchParams }) {
  const state = parseListParams(await searchParams, ANNOUNCEMENT_LIST);
  const [data, exams] = await Promise.all([
    adminList<Announcement>("/admin/announcements/", state, ANNOUNCEMENT_LIST, "/announcements"),
    adminLookup<NoticeExamOption>("/admin/exams/", "", "-created_at"), // newest first: a notice is usually about a recent exam
  ]);
  return <AnnouncementsView data={data} state={state} exams={exams.rows} />;
}
