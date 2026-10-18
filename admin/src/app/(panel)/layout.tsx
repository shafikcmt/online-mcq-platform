import { redirect } from "next/navigation";

import { AppShell } from "@/components/shell/app-shell";
import type { AdminProfile } from "@/components/shell/topbar";
import { ApiError, serverFetch } from "@/lib/api/server";

/** Every panel page is behind this check: the backend decides (session + admin role). */
export default async function PanelLayout({ children }: { children: React.ReactNode }) {
  let profile: AdminProfile;
  try {
    profile = await serverFetch<AdminProfile>("/admin/auth/me/");
  } catch (error) {
    if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
      redirect("/login?expired=1");
    }
    throw error;
  }
  return <AppShell profile={profile}>{children}</AppShell>;
}
