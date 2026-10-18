import type { Metadata } from "next";

import { DashboardView } from "@/components/dashboard/dashboard-view";
import { adminRead } from "@/lib/api/server";
import type { AdminDashboard } from "@/types/admin";

export const metadata: Metadata = { title: "Dashboard" };

export default async function DashboardPage() {
  const data = await adminRead<AdminDashboard>("/admin/dashboard/");
  return <DashboardView data={data} />;
}
