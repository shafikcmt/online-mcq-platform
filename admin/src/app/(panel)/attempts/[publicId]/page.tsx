import { AttemptDetail } from "@/components/attempts/attempt-detail";
import { readAttempt } from "@/lib/api/attempt-page";
import { titleMetadata } from "@/lib/i18n/metadata";

type Params = Promise<{ publicId: string }>;

export const generateMetadata = () => titleMetadata("attemptDetail.title");

export default async function AttemptPage({ params }: { params: Params }) {
  const attempt = await readAttempt((await params).publicId);
  return <AttemptDetail attempt={attempt} />;
}
