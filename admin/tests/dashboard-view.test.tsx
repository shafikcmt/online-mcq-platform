import { screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { DashboardView } from "@/components/dashboard/dashboard-view";
import type { AdminDashboard } from "@/types/admin";

import { exam } from "./content-helpers";
import { renderWithI18n } from "./helpers";

const data: AdminDashboard = {
  server_time: "2026-10-18T06:30:00Z",
  period: {
    time_zone: "Asia/Dhaka",
    today_start: "2026-10-17T18:00:00Z",
    today_end: "2026-10-18T18:00:00Z",
    month_start: "2026-09-30T18:00:00Z",
    month_end: "2026-10-31T18:00:00Z",
  },
  users: { students_total: 1250, students_active: 1190 },
  exams: { total: 42, draft: 5, published: 30, unpublished: 4, archived: 3, open_now: 6, upcoming: 9 },
  attempts: { started_today: 318, submitted_today: 290, in_progress: 21 },
  subscriptions: { active_now: 402, students_with_active: 377 },
  payments: {
    by_status: { initiated: 3, pending: 2, success: 410, failed: 12, cancelled: 7 },
    success_this_month: 64,
    revenue_this_month: [{ currency: "BDT", amount: "31936.00" }],
  },
};

describe("DashboardView", () => {
  it("renders every server number without recomputing business state", () => {
    renderWithI18n(<DashboardView data={data} recentExams={[]} />);
    expect(screen.getByRole("heading", { level: 1, name: "Dashboard" })).toBeInTheDocument();
    expect(screen.getByText("1,250")).toBeInTheDocument();
    expect(screen.getByText("1,190 active accounts")).toBeInTheDocument();
    expect(screen.getByText("318")).toBeInTheDocument();
    expect(screen.getByText("290 submitted · 21 in progress now")).toBeInTheDocument();
    expect(screen.getByText("402")).toBeInTheDocument();
    expect(screen.getByText("377 students with access")).toBeInTheDocument();
    expect(screen.getByText("৳ 31,936.00")).toBeInTheDocument();
    expect(screen.getByText("64 successful payments")).toBeInTheDocument();
    expect(screen.getByText(/Asia\/Dhaka/)).toBeInTheDocument();
  });

  it("labels statuses with text, not colour alone", () => {
    renderWithI18n(<DashboardView data={data} recentExams={[]} />);
    const payments = screen.getByRole("region", { name: "Payments by status" });
    for (const label of ["Successful", "Pending", "Initiated", "Failed", "Cancelled"]) {
      expect(within(payments).getByText(label)).toBeInTheDocument();
    }
    expect(within(payments).getByText("410")).toBeInTheDocument();
    expect(within(payments).getByText("434 payments in total")).toBeInTheDocument();
    const exams = screen.getByRole("region", { name: "Exams" });
    expect(within(exams).getByText("Open now")).toBeInTheDocument();
    expect(within(exams).getByText("6")).toBeInTheDocument();
    expect(within(exams).getByText("Upcoming")).toBeInTheDocument();
  });

  it("handles an empty platform honestly", () => {
    const empty: AdminDashboard = {
      ...data,
      users: { students_total: 0, students_active: 0 },
      exams: { total: 0, draft: 0, published: 0, unpublished: 0, archived: 0, open_now: 0, upcoming: 0 },
      payments: { by_status: { initiated: 0, pending: 0, success: 0, failed: 0, cancelled: 0 }, success_this_month: 0, revenue_this_month: [] },
    };
    renderWithI18n(<DashboardView data={empty} recentExams={[]} />);
    expect(screen.getByText("৳ 0.00")).toBeInTheDocument();
    expect(screen.getByText("No successful payments yet")).toBeInTheDocument();
    expect(screen.queryByRole("img", { name: "Payments by status" })).not.toBeInTheDocument();
  });

  it("renders in Bangla", () => {
    renderWithI18n(<DashboardView data={data} recentExams={[]} />, "bn");
    expect(screen.getByRole("heading", { level: 1, name: "ড্যাশবোর্ড" })).toBeInTheDocument();
    expect(screen.getAllByText("সফল").length).toBeGreaterThan(0);
  });

  it("lists the newest exams with their status as text, or says why there are none", () => {
    const { unmount } = renderWithI18n(
      <DashboardView data={data} recentExams={[exam({ id: 7, title_en: "Physics weekly", status: "draft" })]} />,
    );
    const recent = screen.getByRole("region", { name: "Recent exams" });
    expect(within(recent).getByRole("link", { name: /Physics weekly/ })).toHaveAttribute("href", "/exams/7");
    expect(within(recent).getByText("Draft")).toBeInTheDocument();
    expect(within(recent).getByRole("link", { name: /All exams/ })).toHaveAttribute("href", "/exams");
    unmount();

    renderWithI18n(<DashboardView data={data} recentExams={[]} />);
    expect(screen.getByText("No exams yet. Create the first one to see it here.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "New exam" })).toHaveAttribute("href", "/exams/new");
  });

  it("a failed recent-exams read only empties its own card", () => {
    renderWithI18n(<DashboardView data={data} recentExams={null} />);
    expect(screen.getByText("Recent exams can't be loaded right now. Reload the page to try again.")).toBeInTheDocument();
    expect(screen.getByText("1,250")).toBeInTheDocument();
  });

  it("uses the singular for a count of one", () => {
    renderWithI18n(<DashboardView data={{ ...data, subscriptions: { active_now: 1, students_with_active: 1 } }} recentExams={[]} />);
    expect(screen.getByText("1 student with access")).toBeInTheDocument();
  });
});
