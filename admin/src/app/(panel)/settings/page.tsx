import { SettingsView } from "@/components/cms/settings-view";
import { adminRead } from "@/lib/api/server";
import { titleMetadata } from "@/lib/i18n/metadata";
import type { SiteSettings } from "@/types/cms";

export const generateMetadata = () => titleMetadata("settings.title");

export default async function SettingsPage() {
  const settings = await adminRead<SiteSettings>("/admin/settings/");
  return <SettingsView settings={settings} />;
}
