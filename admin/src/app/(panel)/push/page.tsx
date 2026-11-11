import { PushView } from "@/components/push/push-view";
import { adminList, adminLookup } from "@/lib/api/lists";
import { PUSH_LIST } from "@/lib/content-specs";
import { titleMetadata } from "@/lib/i18n/metadata";
import { parseListParams } from "@/lib/list-params";
import { adminRead } from "@/lib/api/server";
import type { PushExamOption, PushMessage, PushStatusInfo } from "@/types/push";

export const generateMetadata = () => titleMetadata("push.title");

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function PushPage({ searchParams }: { searchParams: SearchParams }) {
  const state = parseListParams(await searchParams, PUSH_LIST);
  const [data, status, exams] = await Promise.all([
    adminList<PushMessage>("/admin/push/messages/", state, PUSH_LIST, "/push"),
    adminRead<PushStatusInfo>("/admin/push/"),
    adminLookup<PushExamOption>("/admin/exams/", "status=published", "-created_at"),
  ]);
  return <PushView data={data} state={state} status={status} exams={exams.rows} />;
}
