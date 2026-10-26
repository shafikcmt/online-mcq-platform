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
    expect(screen.queryByRole("link", { name: /Contact messages/ })).not.toBeInTheDocument();
    const contact = screen.getByText("Contact messages").closest("[aria-disabled]");
    expect(contact).toHaveAttribute("aria-disabled", "true");
    expect(contact).toHaveTextContent("Contact messages (Soon)"); // announced, not just dimmed
  });

  it("links the screens built so far (Milestones 7B–7H and the website content screens)", () => {
    renderWithI18n(<SidebarNav />);
    expect(screen.getByRole("link", { name: "Categories" })).toHaveAttribute("href", "/categories");
    expect(screen.getByRole("link", { name: "Subjects" })).toHaveAttribute("href", "/subjects");
    expect(screen.getByRole("link", { name: "Questions" })).toHaveAttribute("href", "/questions");
    expect(screen.getByRole("link", { name: "Exams" })).toHaveAttribute("href", "/exams");
    expect(screen.getByRole("link", { name: "Results" })).toHaveAttribute("href", "/results");
    expect(screen.getByRole("link", { name: "Users" })).toHaveAttribute("href", "/users");
    expect(screen.getByRole("link", { name: "Attempts" })).toHaveAttribute("href", "/attempts");
    expect(screen.getByRole("link", { name: "Packages" })).toHaveAttribute("href", "/packages");
    expect(screen.getByRole("link", { name: "Subscriptions" })).toHaveAttribute("href", "/subscriptions");
    expect(screen.getByRole("link", { name: "Payments" })).toHaveAttribute("href", "/payments");
    expect(screen.getByRole("link", { name: "Announcements" })).toHaveAttribute("href", "/announcements");
    expect(screen.getByRole("link", { name: "FAQ" })).toHaveAttribute("href", "/faqs");
    expect(screen.getByRole("link", { name: "Pages" })).toHaveAttribute("href", "/pages");
    expect(screen.queryByRole("link", { name: /Contact messages/ })).not.toBeInTheDocument(); // not built yet
  });

  it("keeps labels for screen readers when collapsed", () => {
    renderWithI18n(<SidebarNav collapsed />);
    expect(screen.getByRole("link", { name: "Dashboard" })).toBeInTheDocument();
  });
});
