import { AuditLogView } from "@/components/cms/audit-log-view";
import { adminList } from "@/lib/api/lists";
import { AUDIT_LIST } from "@/lib/content-specs";
import { titleMetadata } from "@/lib/i18n/metadata";
import { parseListParams } from "@/lib/list-params";
import type { AuditEntry } from "@/types/audit";

export const generateMetadata = () => titleMetadata("audit.title");

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function AuditLogPage({ searchParams }: { searchParams: SearchParams }) {
  const state = parseListParams(await searchParams, AUDIT_LIST);
  const data = await adminList<AuditEntry>("/admin/audit-logs/", state, AUDIT_LIST, "/audit-log");
  return <AuditLogView data={data} state={state} />;
}
