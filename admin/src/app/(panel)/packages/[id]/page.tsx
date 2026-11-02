import { PackageEditor } from "@/components/packages/package-editor";
import { packageLookups, readPackage } from "@/lib/api/package-page";
import { titleMetadata } from "@/lib/i18n/metadata";

type Params = Promise<{ id: string }>;

export const generateMetadata = () => titleMetadata("package.editTitle");

export default async function PackagePage({ params }: { params: Params }) {
  const [{ pkg, rules }, lookups] = await Promise.all([readPackage((await params).id), packageLookups()]);
  return <PackageEditor key={pkg.id} pkg={pkg} rules={rules} {...lookups} />;
}
