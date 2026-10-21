import { PackageEditor } from "@/components/packages/package-editor";
import { packageLookups } from "@/lib/api/package-page";
import { titleMetadata } from "@/lib/i18n/metadata";

export const generateMetadata = () => titleMetadata("package.createTitle");

export default async function NewPackagePage() {
  const lookups = await packageLookups();
  return <PackageEditor pkg={null} rules={[]} {...lookups} />;
}
