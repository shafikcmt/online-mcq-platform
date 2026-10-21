import { UserDetail } from "@/components/users/user-detail";
import { readUser } from "@/lib/api/user-page";
import { titleMetadata } from "@/lib/i18n/metadata";

type Params = Promise<{ id: string }>;

export const generateMetadata = () => titleMetadata("userDetail.title");

export default async function UserPage({ params }: { params: Params }) {
  const user = await readUser((await params).id);
  return <UserDetail user={user} />;
}
