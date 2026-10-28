import type { Metadata } from "next";

import { DashboardView } from "@/components/dashboard/dashboard-view";
import { adminRead, serverFetch } from "@/lib/api/server";
import type { AdminDashboard } from "@/types/admin";
import type { Paginated } from "@/types/content";
import type { Exam } from "@/types/exams";

export const metadata: Metadata = { title: "Dashboard" };

export default async function DashboardPage() {
  const [data, recentExams] = await Promise.all([
    adminRead<AdminDashboard>("/admin/dashboard/"),
    // The existing exam list, newest first. If only this read fails, its card says so and
    // the rest of the dashboard still shows (a signed-out session is handled by the read above).
    serverFetch<Paginated<Exam>>("/admin/exams/?ordering=-created_at&page_size=5").then(
      (page) => page.results,
      () => null,
    ),
  ]);
  return <DashboardView data={data} recentExams={recentExams} />;
}
