import { ContactMessagesView } from "@/components/cms/contact-messages-view";
import { adminList } from "@/lib/api/lists";
import { CONTACT_LIST } from "@/lib/content-specs";
import { titleMetadata } from "@/lib/i18n/metadata";
import { parseListParams } from "@/lib/list-params";
import type { ContactMessage } from "@/types/cms";

export const generateMetadata = () => titleMetadata("contact.title");

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function ContactMessagesPage({ searchParams }: { searchParams: SearchParams }) {
  const state = parseListParams(await searchParams, CONTACT_LIST);
  const data = await adminList<ContactMessage>("/admin/contact-messages/", state, CONTACT_LIST, "/contact-messages");
  return <ContactMessagesView data={data} state={state} />;
}
