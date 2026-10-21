import { FormSkeleton } from "@/components/content/form-skeleton";
import { MESSAGES, translate } from "@/lib/i18n/messages";
import { getLocale } from "@/lib/i18n/server";

export default async function Loading() {
  const locale = await getLocale();
  return <FormSkeleton label={translate(MESSAGES[locale], "common.loading")} />;
}
