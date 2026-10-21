import { screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ usePathname: () => "/dashboard" }));

import { SidebarNav } from "@/components/shell/sidebar";

import { renderWithI18n } from "./helpers";

describe("SidebarNav", () => {
  it("marks the current page and lists every admin area", () => {
    renderWithI18n(<SidebarNav />);
    const nav = screen.getByRole("navigation", { name: "Main navigation" });
    expect(nav).toBeInTheDocument();
    const dashboard = screen.getByRole("link", { name: "Dashboard" });
    expect(dashboard).toHaveAttribute("aria-current", "page");
    expect(dashboard).toHaveAttribute("href", "/dashboard");
    for (const label of ["Users", "Questions", "Exams", "Payments", "Audit log"]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });

  it("does not link to screens that are not built yet", () => {
    renderWithI18n(<SidebarNav />);
    expect(screen.queryByRole("link", { name: /Payments/ })).not.toBeInTheDocument();
    const payments = screen.getByText("Payments").closest("[aria-disabled]");
    expect(payments).toHaveAttribute("aria-disabled", "true");
    expect(payments).toHaveTextContent("Payments (Soon)"); // announced, not just dimmed
  });

  it("links the content screens built in Milestones 7B and 7C", () => {
    renderWithI18n(<SidebarNav />);
    expect(screen.getByRole("link", { name: "Categories" })).toHaveAttribute("href", "/categories");
    expect(screen.getByRole("link", { name: "Subjects" })).toHaveAttribute("href", "/subjects");
    expect(screen.getByRole("link", { name: "Questions" })).toHaveAttribute("href", "/questions");
    expect(screen.getByRole("link", { name: "Exams" })).toHaveAttribute("href", "/exams");
    expect(screen.queryByRole("link", { name: /Results/ })).not.toBeInTheDocument(); // not built yet
  });

  it("keeps labels for screen readers when collapsed", () => {
    renderWithI18n(<SidebarNav collapsed />);
    expect(screen.getByRole("link", { name: "Dashboard" })).toBeInTheDocument();
  });
});
