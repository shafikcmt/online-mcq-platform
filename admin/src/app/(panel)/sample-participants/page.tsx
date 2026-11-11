import { SamplePeopleView } from "@/components/sample/sample-people-view";
import { adminList } from "@/lib/api/lists";
import { SAMPLE_PERSON_LIST } from "@/lib/content-specs";
import { titleMetadata } from "@/lib/i18n/metadata";
import { parseListParams } from "@/lib/list-params";
import type { SamplePerson } from "@/types/sample";

export const generateMetadata = () => titleMetadata("sp.title");

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function SamplePeoplePage({ searchParams }: { searchParams: SearchParams }) {
  const state = parseListParams(await searchParams, SAMPLE_PERSON_LIST);
  const data = await adminList<SamplePerson>("/admin/sample-participants/", state, SAMPLE_PERSON_LIST, "/sample-participants");
  return <SamplePeopleView data={data} state={state} />;
}
